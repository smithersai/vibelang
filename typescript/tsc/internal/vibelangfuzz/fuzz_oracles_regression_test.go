package vibelangfuzz

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceShorthandRejectionOracle(t *testing.T) {
	diagnostic := func(code int32, source string) *ast.Diagnostic {
		return ast.NewDiagnosticFromText(nil, core.TextRange{}, code, diagnostics.CategoryError, "static member", nil, nil, false, false).SetExternalData(source, "static member")
	}
	native := diagnostic(2339, "")

	for _, tc := range []struct {
		name   string
		errors []*ast.Diagnostic
		want   bool
	}{
		{"native-static-member", []*ast.Diagnostic{native}, true},
		{"accepted", nil, false},
		{"unrelated", []*ast.Diagnostic{diagnostic(2304, "")}, false},
		{"external-same-code", []*ast.Diagnostic{diagnostic(2339, "external")}, false},
		{"extra-error", []*ast.Diagnostic{native, diagnostic(2304, "")}, false},
		{"duplicate-error", []*ast.Diagnostic{native, native}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := serviceShorthandRejected(tc.errors, 2339); got != tc.want {
				t.Fatalf("rejection = %t, want %t for %v", got, tc.want, tc.errors)
			}
		})
	}
}

// Missing prerequisites must stop the target before it compares compilers.
// Run the real target in a child so changing PATH cannot affect other tests.
func TestSidecarOutsideRootMissingNode(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"FuzzSidecarOutsideRoot", "FuzzSidecarSourceIdentity"} {
		t.Run(target, func(t *testing.T) {
			cmd := exec.CommandContext(t.Context(), executable, "-test.run=^"+target+"$", "-test.v")
			for _, variable := range os.Environ() {
				if strings.HasPrefix(variable, "PATH=") || strings.HasPrefix(variable, "VIBELANG_FUZZ_REQUIRE=") {
					continue
				}
				cmd.Env = append(cmd.Env, variable)
			}
			cmd.Env = append(cmd.Env, "PATH="+filepath.Join(t.TempDir(), "empty"), "VIBELANG_FUZZ_REQUIRE=0")
			output, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "--- SKIP: "+target) || !strings.Contains(string(output), "node") {
				t.Fatalf("missing node must skip %s: %v\n%s", target, err, output)
			}
		})
	}
}

func TestSidecarLayoutCommand(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"0", "2"} {
		t.Run("exit-"+code, func(t *testing.T) {
			success, output, err := sidecarCommand(t.Context(), t.TempDir(), executable, "-test.run=^TestSidecarLayoutProcess$", "--", code)
			if err != nil || success != (code == "0") || !strings.Contains(output, "error TS6059") {
				t.Fatalf("compiler observation: success=%t error=%v output=%q", success, err, output)
			}
		})
	}
	t.Run("missing-executable", func(t *testing.T) {
		success, _, err := sidecarCommand(t.Context(), t.TempDir(), filepath.Join(t.TempDir(), "missing"))
		if success || err == nil {
			t.Fatalf("launch failure became observation: %t %v", success, err)
		}
	})
	t.Run("lookup-failure", func(t *testing.T) {
		success, _, err := sidecarCommand(t.Context(), t.TempDir(), "sidecar-compiler-that-does-not-exist")
		var start *exec.Error
		if success || !errors.As(err, &start) {
			t.Fatalf("lookup failure became observation: %t %v", success, err)
		}
	})
	t.Run("not-executable", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "compiler")
		if err := os.WriteFile(path, []byte("not executable"), 0600); err != nil {
			t.Fatal(err)
		}
		success, _, err := sidecarCommand(t.Context(), t.TempDir(), path)
		if success || err == nil {
			t.Fatalf("permission failure became observation: %t %v", success, err)
		}
	})
	t.Run("cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		success, _, err := sidecarCommand(ctx, t.TempDir(), executable)
		if success || !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation became observation: %t %v", success, err)
		}
	})
}

func TestSidecarLayoutProcess(t *testing.T) {
	if len(os.Args) < 2 || os.Args[len(os.Args)-2] != "--" {
		return
	}
	fmt.Println("error TS6059: fixture observation")
	if os.Args[len(os.Args)-1] == "2" {
		os.Exit(2)
	}
	os.Exit(0)
}

// Chapter 7 retains native static errors. Dot and indexed accesses have
// distinct native codes under strict checking, despite naming the same member.
func TestServiceShorthandNativeDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	for _, tc := range []struct {
		access string
		code   int32
	}{
		{".record", 2339},
		{"[\"record\"]", 7053},
	} {
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{
			"main.ts": "class Audit {}\nexport const call = Audit" + tc.access + "({n:1})\n",
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []*ast.Diagnostic
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d)
			}
		}
		if !serviceShorthandRejected(errors, tc.code) {
			t.Fatalf("native %s: want TS%d, got %v", tc.access, tc.code, errors)
		}
	}
}
