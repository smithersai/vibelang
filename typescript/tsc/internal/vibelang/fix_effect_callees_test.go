package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixVIPOnly runs vibelang --fix --fix-vip-only on source as main.vibe and
// returns what it wrote (source when it wrote nothing).
func fixVIPOnly(t *testing.T, source string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if fixed := result.Files[file.FileName()]; fixed != nil {
		return fixed.Text
	}
	return source
}

// The VIP migration decides each tried call by the value the call gives
// once its callee keeps the kind VIP-1 writes. VIP-1: a function with
// "neither keyword" is "plain JavaScript", so a call to one that stays plain
// (D421) gives its value and loses its try, written or not. VIP-5 and
// Chapter 2's operand test make a written Effect subtype, such as an error
// instance, an Effect: that try stays, or its failure becomes success data.
// Each callee kind is called in each position an effect function holds,
// with and without a written try.
func TestFixVIPTriedCalleeKinds(t *testing.T) {
	callees := []struct {
		key, declaration string
		keeps            bool
	}{
		{"plain-declaration", "function value(n: number) {\n  return n * 2\n}", false},
		{"plain-annotated-declaration", "function value(n: number): number {\n  return n * 2\n}", false},
		{"plain-annotated-arrow", "const value = (n: number): number => n * 2", false},
		{"tagged-error-arrow", "const value = (n: number): Missing => new Missing({ id: String(n) })", true},
		{"tagged-error-declaration", "function value(n: number): Missing {\n  return new Missing({ id: String(n) })\n}", true},
	}
	positions := []struct{ key, statement string }{
		{"initializer", "const held = CALL"},
		{"array", "const held = [CALL]"},
		{"statement", "if (a.n > 100) { CALL }"},
		{"argument", "const held = String(CALL)"},
	}
	for _, callee := range callees {
		for _, position := range positions {
			for _, written := range []bool{false, true} {
				if callee.keeps && !written {
					continue // an error value needs its try to fail; without one it is data before and after
				}
				call, name := "value(1)", callee.key+"/"+position.key
				if written {
					call, name = "try value(1)", name+"/written-try"
				}
				t.Run(name, func(t *testing.T) {
					source := "error Missing { id: string }\nfunction load(n: number) {\n  try yieldNow()\n  return { n }\n}\n" + callee.declaration +
						"\nexport function main() {\n  const a = try load(1)\n  " + strings.ReplaceAll(position.statement, "CALL", call) + "\n  return a.n\n}\n"
					got := fixVIPOnly(t, source)
					if !strings.Contains(got, "export effect function main()") {
						t.Fatalf("main runs try load(1), so it becomes an effect function:\n%s", got)
					}
					if tried := strings.Contains(got, "try value(1)"); tried != callee.keeps || !strings.Contains(got, "value(1)") {
						t.Fatalf("--fix-vip-only keeps try value(1) = %t, want %t:\n%s\nwrote\n%s", tried, callee.keeps, source, got)
					}
				})
			}
		}
	}
}
