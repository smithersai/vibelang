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

// VIP-34 preserves run phase and types. The retired prelude exports were
// factories; an untried call can intentionally hold or return the cold program.
func TestFixNativeFactoryColdValues(t *testing.T) {
	for _, tc := range []struct {
		name, source                string
		migrationOnly, runStatement bool
	}{
		{"yield-return", "export effect function main(): Effect.Effect<void>!! { return yieldNow(2) }", false, false},
		{"zero-yield-return", "export effect function main(): Effect.Effect<void>!! { return yieldNow() }", false, false},
		{"zero-interrupt-return", "export effect function main(): Effect.Effect<never>!! { return interrupt() }", false, false},
		{"plain-factory", "export function make(): Effect.Effect<void> { return yieldNow(2) }", false, false},
		{"top-level", "export const program: Effect.Effect<void> = yieldNow(2)", false, false},
		{"async-factory", "export async function make(): Promise<Effect.Effect<void>> { return yieldNow(2) }", false, false},
		{"argument", "export effect function main() { return Effect.isEffect(yieldNow(2)) }", false, false},
		{"array", "export effect function main(): ReadonlyArray<Effect.Effect<void>>!! { return [yieldNow(2)] }", false, false},
		{"conditional", "export effect function main(flag: boolean): Effect.Effect<void>!! { return flag ? yieldNow(2) : yieldNow(undefined) }", false, false},
		{"spread", "const args: [number?] = []; export const program: Effect.Effect<void> = yieldNow(...args)", false, false},
		{"optional", "export const program: Effect.Effect<void> = yieldNow?.(2)", false, false},
		{"asi", "export effect function main() { let prior = 2\n yieldNow(prior)\n return prior }", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			configPath := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(configPath, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errs) != 0 {
				t.Fatal(errs)
			}
			options := FixOptions{MigrationOnly: tc.migrationOnly}
			fixed := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			changed := fixed.Files[file.FileName()]
			if fixed.Err != nil || len(fixed.Refused) != 0 || changed == nil {
				t.Fatalf("missing phase-preserving migration: err=%v refused=%+v file=%+v", fixed.Err, fixed.Refused, changed)
			}
			if got := strings.Contains(changed.Text, "try "); got != tc.runStatement {
				t.Fatalf("factory run phase: got try=%v, want %v:\n%s", got, tc.runStatement, changed.Text)
			}
			program, parsed, _, _ := editorProgram(t, changed.Text)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), parsed) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source rejected: %s\n%s", diagnosticWithNotes(d), changed.Text)
				}
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(changed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}
