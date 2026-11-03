package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixFiberPlacementPreservesColdPrograms(t *testing.T) {
	for _, source := range []string{
		"function f() { const child = fork Effect.succeed(1) }",
		"function f(child: Fiber.Fiber<number>) { return join child }",
		"function f(children: Fiber.Fiber<number>[]) { return join children }",
		"const f = () => join fork Effect.succeed(1)",
		"effect function f(value = fork Effect.succeed(1)) { return 1 }",
		"class C { value = fork Effect.succeed(1) }",
		"const $plainFork = 1; function f() { return fork Effect.succeed($plainFork) }",
		"function f() { return fork /* keep */ Effect.succeed(1) }",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), config)
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Refused) != 0 || result.Err != nil {
				t.Fatalf("no preserving --fix: files=%v refused=%+v err=%v", result.Order, result.Refused, result.Err)
			}
			if strings.Contains(source, "fork ") && !strings.Contains(fixed.Text, "forkScoped as $plainFork") {
				t.Fatalf("fork did not keep its cold API call:\n%s", fixed.Text)
			}
			if strings.Contains(source, "join ") && !strings.Contains(fixed.Text, "$join as $plainJoin") {
				t.Fatalf("join did not keep its cold helper call:\n%s", fixed.Text)
			}
			if strings.Contains(fixed.Text, "effect function f()") || strings.Contains(fixed.Text, "effect () =>") {
				t.Fatalf("a cold plain function became effectful:\n%s", fixed.Text)
			}
			if strings.Contains(source, "/* keep */") && !strings.Contains(fixed.Text, "/* keep */") {
				t.Fatalf("comment lost:\n%s", fixed.Text)
			}
			if err := os.WriteFile(string(file.FileName()), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			// Build/check the actual rewritten source, including every new import.
			program, _, _, _ := editorProgram(t, fixed.Text)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), nil), program.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("rewritten source: %s\n%s", d.String(), fixed.Text)
				}
			}
			again := FixProject(t.Context(), fs, bundled.LibPath(), config)
			if len(again.Files) != 0 || len(again.Refused) != 0 || again.Err != nil {
				t.Fatalf("--fix is not idempotent: %+v", again)
			}
		})
	}
}
