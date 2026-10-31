package vibelangfmt_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	tsformat "github.com/microsoft/TypeScript/tsc/internal/format"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func foldkitLSFormatter(text string) (string, error) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/format.ts", PathKey: "/format.ts"}, text, core.ScriptKindTS)
	ctx := tsformat.WithFormatCodeSettings(context.Background(), lsutil.GetDefaultFormatCodeSettings(), "\n")
	return core.ApplyBulkEdits(text, tsformat.FormatDocument(ctx, file)), nil
}

// These are the ten compiler-valid files rejected during the foldkit Option
// migration, plus its minimized witnesses. Keep the original source as corpus.
func TestFoldkitNativeOptionControl(t *testing.T) {
	for _, host := range []string{"language-server", "dprint"} {
		t.Run(host, func(t *testing.T) {
			formatter := vibelangfmt.TypeScriptFormatter(foldkitLSFormatter)
			if host == "dprint" {
				formatter = foldkitDprintFormatter(t)
			}
			err := filepath.WalkDir("testdata/foldkit-native-option-control", func(name string, entry os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if entry.IsDir() {
					return nil
				}
				t.Run(strings.TrimPrefix(name, "testdata/foldkit-native-option-control/"), func(t *testing.T) {
					data, err := os.ReadFile(name)
					if err != nil {
						t.Fatal(err)
					}
					source := string(data)
					once, err := vibelangfmt.Format(name, source, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if err := vibelangfmt.SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					twice, err := vibelangfmt.Format(name, once, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if once != twice {
						t.Fatalf("not idempotent\nonce:\n%s\ntwice:\n%s", once, twice)
					}
				})
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Parentheses already retained by a host must not accumulate on each pass.
func TestFoldkitNativeOptionUnchangedHost(t *testing.T) {
	source := "function read(input: Option<number>) { return ((match (input) { when Option.None: 0; when Option.Some(let value): value; })) }"
	host := func(text string) (string, error) { return text, nil }
	once, err := vibelangfmt.Format("read.vibe", source, host)
	if err != nil {
		t.Fatal(err)
	}
	twice, err := vibelangfmt.Format("read.vibe", once, host)
	if err != nil || once != twice {
		t.Fatalf("unstable grouping: %v\n%s\n%s", err, once, twice)
	}
}

func foldkitDprintFormatter(t *testing.T) vibelangfmt.TypeScriptFormatter {
	t.Helper()
	binary := os.Getenv("VIBELANG_DPRINT")
	if binary == "" {
		t.Skip("set VIBELANG_DPRINT to run dprint regressions")
	}
	config, err := filepath.Abs("testdata/dprint.json")
	if err != nil {
		t.Fatal(err)
	}
	return func(text string) (string, error) {
		cmd := exec.Command(binary, "fmt", "--config", config, "--stdin", "file.ts")
		cmd.Stdin = strings.NewReader(text)
		var out, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &stderr
		if err := cmd.Run(); err != nil {
			return "", fmt.Errorf("%w: %s", err, stderr.String())
		}
		return out.String(), nil
	}
}

// TestFoldkitIsBodyRebrace pins the layout of braces the formatter restores
// around a bound is condition's single-statement bodies after a host removed
// them: a block on its own lines, as the host writes blocks it keeps.
func TestFoldkitIsBodyRebrace(t *testing.T) {
	source := "export const read = (input: Option<number>): number => {\n  if (input is Option.Some(let value)) { return value } else { return 0 }\n}\n"
	want := "export const read = (input: Option<number>): number => {\n  if (input is Option.Some(let value)) {\n    return value\n  } else {\n    return 0\n  }\n}\n"
	unbrace := func(text string) (string, error) {
		after := strings.Replace(text, ") { return value } else { return 0 }", ")\n    return value\n  else return 0", 1)
		if after == text {
			t.Fatal("the host did not see the bodies")
		}
		return after, nil
	}
	t.Run("unbracing host", func(t *testing.T) {
		once, err := vibelangfmt.Format("read.vibe", source, unbrace)
		if err != nil {
			t.Fatal(err)
		}
		if once != want {
			t.Fatalf("got:\n%s\nwant:\n%s", once, want)
		}
	})
	t.Run("trailing comment", func(t *testing.T) {
		commented := strings.Replace(source, "{ return value }", "{ return value /* picked */ }", 1)
		host := func(text string) (string, error) {
			after := strings.Replace(text, ") { return value /* picked */ } else { return 0 }", ")\n    return value /* picked */\n  else return 0", 1)
			if after == text {
				t.Fatal("the host did not see the bodies")
			}
			return after, nil
		}
		once, err := vibelangfmt.Format("read.vibe", commented, host)
		if err != nil {
			t.Fatal(err)
		}
		if expect := strings.Replace(want, "return value", "return value /* picked */", 1); once != expect {
			t.Fatalf("got:\n%s\nwant:\n%s", once, expect)
		}
	})
	t.Run("dprint", func(t *testing.T) {
		host := foldkitDprintFormatter(t)
		data, err := os.ReadFile("testdata/foldkit-native-option-control/minimal/branch.before.txt")
		if err != nil {
			t.Fatal(err)
		}
		once, err := vibelangfmt.Format("branch.vibe", string(data), host)
		if err != nil {
			t.Fatal(err)
		}
		if once != want {
			t.Fatalf("got:\n%s\nwant:\n%s", once, want)
		}
		twice, err := vibelangfmt.Format("branch.vibe", once, host)
		if err != nil || twice != once {
			t.Fatalf("not idempotent: %v\n%s", err, twice)
		}
	})
}
