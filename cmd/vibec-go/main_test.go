package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/smithersai/vibelang/compiler"
)

type compilerFunc func(context.Context, compiler.CompileRequest) (compiler.CompileResult, error)

func (function compilerFunc) Compile(ctx context.Context, request compiler.CompileRequest) (compiler.CompileResult, error) {
	return function(ctx, request)
}

func decodeResult(t *testing.T, output *bytes.Buffer) compiler.CompileResult {
	t.Helper()
	var result compiler.CompileResult
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		t.Fatalf("decode CLI result: %v\n%s", err, output.String())
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		t.Fatalf("CLI wrote more than one JSON value: %v\n%s", err, output.String())
	}
	return result
}

type errorWriter struct{}

func (errorWriter) Write([]byte) (int, error) { return 0, errors.New("write failed") }

func TestMetadataFlagsRemainDependencyFree(t *testing.T) {
	for _, test := range []struct {
		args []string
		want string
	}{
		{args: []string{"--version"}, want: "vibec-go " + version + "\n"},
		{args: []string{"--api-version"}, want: strconv.Itoa(compiler.APIVersion) + "\n"},
	} {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		factoryCalled := false
		exit := runWithFactory(test.args, &stdout, &stderr, func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
			factoryCalled = true
			return nil, errors.New("must not be called")
		})
		if exit != 0 || stdout.String() != test.want || stderr.Len() != 0 || factoryCalled {
			t.Fatalf("metadata flag: exit=%d stdout=%q stderr=%q factory=%v", exit, stdout.String(), stderr.String(), factoryCalled)
		}
	}
}

func TestMetadataWriteFailureIsNotSuccess(t *testing.T) {
	for _, args := range [][]string{{"--version"}, {"--api-version"}} {
		var stderr bytes.Buffer
		if exit := runWithFactory(args, errorWriter{}, &stderr, nil); exit != 1 || !strings.Contains(stderr.String(), "write failed") {
			t.Fatalf("args=%v exit=%d stderr=%q", args, exit, stderr.String())
		}
	}
}

func TestMetadataFlagsRespectParsingAndDoubleDash(t *testing.T) {
	t.Run("invalid companion flag", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		exit := runWithFactory([]string{"--version", "--not-a-flag"}, &stdout, &stderr, nil)
		if exit != 64 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "flag provided but not defined") {
			t.Fatalf("exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
		}
	})

	t.Run("double dash protects source name", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		var gotRequest compiler.CompileRequest
		exit := runWithFactory([]string{"--fork-checkout", "/fork", "--", "--version"}, &stdout, &stderr,
			func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
				return compilerFunc(func(_ context.Context, request compiler.CompileRequest) (compiler.CompileResult, error) {
					gotRequest = request
					return compiler.CompileResult{}, nil
				}), nil
			})
		if exit != 0 || stderr.Len() != 0 || len(gotRequest.RootNames) != 1 || gotRequest.RootNames[0] != "--version" {
			t.Fatalf("exit=%d request=%#v stdout=%q stderr=%q", exit, gotRequest, stdout.String(), stderr.String())
		}
	})

	t.Run("help uses stdout", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		exit := runWithFactory([]string{"--help"}, &stdout, &stderr, nil)
		if exit != 0 || !strings.Contains(stdout.String(), "Usage of vibec-go") || stderr.Len() != 0 {
			t.Fatalf("exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
		}
	})
}

func TestExplicitPinnedForkCompilesRootsThroughSelectedBackend(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	var gotConfig compiler.ForkConfig
	var gotRequest compiler.CompileRequest
	exit := runWithFactory([]string{
		"--fork-checkout", "/checked/fork",
		"--fork-cache", "/compiler/cache",
		"--go-command", "/toolchain/go",
		"--timeout", "2s",
		"main.vibe",
	}, &stdout, &stderr, func(_ context.Context, config compiler.ForkConfig) (compiler.Compiler, error) {
		gotConfig = config
		return compilerFunc(func(_ context.Context, request compiler.CompileRequest) (compiler.CompileResult, error) {
			gotRequest = request
			return compiler.CompileResult{
				Artifacts: []compiler.Artifact{{Path: "main.js", Content: []byte("export {};\n")}},
			}, nil
		}), nil
	})
	if exit != 0 || stderr.Len() != 0 {
		t.Fatalf("compile exit=%d stderr=%q", exit, stderr.String())
	}
	if strings.Contains(stdout.String(), ":null") {
		t.Fatalf("successful wire result contains null collection: %q", stdout.String())
	}
	if gotConfig.CheckoutDirectory != "/checked/fork" || gotConfig.CacheDirectory != "/compiler/cache" || gotConfig.GoCommand != "/toolchain/go" {
		t.Fatalf("unexpected config: %#v", gotConfig)
	}
	if len(gotRequest.RootNames) != 1 || gotRequest.RootNames[0] != "main.vibe" {
		t.Fatalf("unexpected request: %#v", gotRequest)
	}
	result := decodeResult(t, &stdout)
	if result.EmitSkipped || len(result.Artifacts) != 1 || result.Artifacts[0].Path != "main.js" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestDiagnosticsAndBackendFailureUseMachineReadableResultAndFailureExit(t *testing.T) {
	t.Run("diagnostic", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		exit := runWithFactory([]string{"--fork-checkout", "/fork", "broken.vibe"}, &stdout, &stderr,
			func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
				return compilerFunc(func(context.Context, compiler.CompileRequest) (compiler.CompileResult, error) {
					return compiler.CompileResult{
						Diagnostics: []compiler.Diagnostic{{Code: "TS2322", Category: compiler.DiagnosticError}},
						EmitSkipped: true,
					}, nil
				}), nil
			})
		if exit != 1 || stderr.Len() != 0 {
			t.Fatalf("diagnostic exit=%d stderr=%q", exit, stderr.String())
		}
		result := decodeResult(t, &stdout)
		if !result.EmitSkipped || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "TS2322" {
			t.Fatalf("unexpected diagnostic result: %#v", result)
		}
	})

	t.Run("backend", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		exit := runWithFactory([]string{"--fork-checkout", "/fork", "main.vibe"}, &stdout, &stderr,
			func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
				return nil, errors.New("fork unavailable")
			})
		if exit != 1 || !strings.Contains(stderr.String(), "fork unavailable") {
			t.Fatalf("backend exit=%d stderr=%q", exit, stderr.String())
		}
		result := decodeResult(t, &stdout)
		if !result.EmitSkipped || result.Diagnostics == nil || result.Artifacts == nil || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "VIBE_GO_BACKEND" || strings.Contains(stdout.String(), ":null") {
			t.Fatal("backend construction failure must report skipped emit")
		}
	})

	t.Run("nil backend", func(t *testing.T) {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		exit := runWithFactory([]string{"--fork-checkout", "/fork", "main.vibe"}, &stdout, &stderr,
			func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
				return nil, nil
			})
		if exit != 1 || !strings.Contains(stderr.String(), "nil backend") || !decodeResult(t, &stdout).EmitSkipped {
			t.Fatalf("exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
		}
	})
}

func TestRequestFlagForwardsFullCompileRequest(t *testing.T) {
	requestPath := filepath.Join(t.TempDir(), "request.json")
	requestJSON := `{
		"rootNames": ["main.vibe"],
		"files": [{
			"path": "main.vibe",
			"kind": "vibe",
			"text": "authored",
			"lowered": {"text": "lowered", "sourceMap": "{}"}
		}],
		"options": {"declaration": true},
		"lowering": "external"
	}`
	if err := os.WriteFile(requestPath, []byte(requestJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	var gotRequest compiler.CompileRequest
	exit := runWithFactory([]string{"--fork-checkout", "/fork", "--request", requestPath}, &stdout, &stderr,
		func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
			return compilerFunc(func(_ context.Context, request compiler.CompileRequest) (compiler.CompileResult, error) {
				gotRequest = request
				return compiler.CompileResult{}, nil
			}), nil
		})
	if exit != 0 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%q", exit, stderr.String())
	}
	if gotRequest.Lowering != compiler.LoweringExternal ||
		len(gotRequest.RootNames) != 1 || gotRequest.RootNames[0] != "main.vibe" ||
		len(gotRequest.Files) != 1 || gotRequest.Files[0].Text != "authored" ||
		gotRequest.Files[0].Lowered == nil || gotRequest.Files[0].Lowered.Text != "lowered" ||
		gotRequest.Files[0].Lowered.SourceMap != "{}" ||
		gotRequest.Options["declaration"] != true {
		t.Fatalf("request did not round-trip: %#v", gotRequest)
	}
	decodeResult(t, &stdout)
}

func TestRequestFlagUsageErrorsExitBeforeBackendPreparation(t *testing.T) {
	valid := filepath.Join(t.TempDir(), "request.json")
	if err := os.WriteFile(valid, []byte(`{"rootNames":["main.vibe"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	writeRequest := func(t *testing.T, content string) string {
		t.Helper()
		name := filepath.Join(t.TempDir(), "request.json")
		if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return name
	}
	for _, test := range []struct {
		name   string
		args   []string
		detail string
	}{
		{
			name:   "request with positional roots",
			args:   []string{"--request", valid, "main.vibe"},
			detail: "mutually exclusive",
		},
		{
			name:   "missing request file",
			args:   []string{"--request", filepath.Join(t.TempDir(), "absent.json")},
			detail: "absent.json",
		},
		{
			name:   "malformed request JSON",
			args:   []string{"--request", writeRequest(t, "not json")},
			detail: "invalid character",
		},
		{
			name:   "unknown request field",
			args:   []string{"--request", writeRequest(t, `{"rootNames":["main.vibe"],"unknown":true}`)},
			detail: "unknown field",
		},
		{
			name:   "trailing request JSON",
			args:   []string{"--request", writeRequest(t, `{"rootNames":["main.vibe"]}{}`)},
			detail: "one JSON request value",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			factoryCalled := false
			exit := runWithFactory(append([]string{"--fork-checkout", "/fork"}, test.args...), &stdout, &stderr,
				func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
					factoryCalled = true
					return nil, errors.New("must not be called")
				})
			if exit != 64 || stdout.Len() != 0 || factoryCalled {
				t.Fatalf("exit=%d stdout=%q factory=%v stderr=%q", exit, stdout.String(), factoryCalled, stderr.String())
			}
			if !strings.Contains(stderr.String(), test.detail) {
				t.Fatalf("stderr %q does not mention %q", stderr.String(), test.detail)
			}
		})
	}
}

func TestForkOnlyFlagsRequireExplicitCheckout(t *testing.T) {
	for _, args := range [][]string{{"--fork-cache", "/cache"}, {"--go-command", "go1.25"}, {"--timeout", "0s"}} {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		if exit := runWithFactory(args, &stdout, &stderr, nil); exit != 64 {
			t.Fatalf("args %v exited %d, stderr=%q", args, exit, stderr.String())
		}
		if stdout.Len() != 0 {
			t.Fatalf("validation failure wrote JSON output: %q", stdout.String())
		}
	}
}

func TestMissingRootIsUsageErrorBeforeBackendPreparation(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	factoryCalled := false
	exit := runWithFactory([]string{"--fork-checkout", "/fork"}, &stdout, &stderr,
		func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
			factoryCalled = true
			return nil, nil
		})
	if exit != 64 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "at least one root") || factoryCalled {
		t.Fatalf("exit=%d stdout=%q stderr=%q factory=%v", exit, stdout.String(), stderr.String(), factoryCalled)
	}
}

func TestTimeoutCoversBackendExecutionAndKeepsJSONProtocol(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	started := time.Now()
	exit := runWithFactory([]string{"--fork-checkout", "/fork", "--timeout", "20ms", "main.vibe"}, &stdout, &stderr,
		func(context.Context, compiler.ForkConfig) (compiler.Compiler, error) {
			return compilerFunc(func(ctx context.Context, _ compiler.CompileRequest) (compiler.CompileResult, error) {
				<-ctx.Done()
				return compiler.CompileResult{EmitSkipped: true}, errors.New("masked process failure")
			}), nil
		})
	if exit != 1 || time.Since(started) > time.Second || !strings.Contains(stderr.String(), "masked process failure") {
		t.Fatalf("exit=%d elapsed=%s stderr=%q", exit, time.Since(started), stderr.String())
	}
	result := decodeResult(t, &stdout)
	if !result.EmitSkipped || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "VIBE_GO_TIMEOUT" || !strings.Contains(result.Diagnostics[0].Message, context.DeadlineExceeded.Error()) || strings.Contains(stdout.String(), ":null") {
		t.Fatal("timeout must retain a machine-readable skipped result")
	}
}

func TestDependencyFreeScaffoldHasStableJSONCollections(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exit := runWithFactory([]string{"main.vibe"}, &stdout, &stderr, nil)
	if exit != 2 || !strings.Contains(stderr.String(), compiler.ErrNotImplemented.Error()) || strings.Contains(stdout.String(), ":null") {
		t.Fatalf("exit=%d stdout=%q stderr=%q", exit, stdout.String(), stderr.String())
	}
	result := decodeResult(t, &stdout)
	if len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "VIBE0001" || result.Artifacts == nil {
		t.Fatalf("unexpected scaffold result: %#v", result)
	}
}
