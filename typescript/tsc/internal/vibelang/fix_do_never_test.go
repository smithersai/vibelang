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

func TestFixDoNeverResult(t *testing.T) {
	for name, options := range map[string]FixOptions{"default": {}, "migration": {MigrationOnly: true}, "vip": {VIPOnly: true}} {
		t.Run(name, func(t *testing.T) {
			source := `function direct() { return (do { return 5 }).missing }
function inferred() { const value = do { return 5 }; return value.missing }
function invoked() { return (do { return 5 })() }
function iterated() { for (const value of do { return 5 }) {} }
function aliases() { const first = do { return 5 }; const next = first; return next.missing }
function keys() { for (const key in do { return 5 }) {} }
function constructed() { return new (do { return 5 })() }
function arraySpread() { return [...(do { return 5 })] }
function objectSpread() { return { ...(do { return 5 }) } }
function instance() { return (do { return 5 }) instanceof Object }
function tagged() { return (do { return 5 })` + "`text`" + ` }
function valid() { const value: never = do { return 5 }; return value }
function ordinary(value: never) { return value.missing }
`
			program, file, _, _ := editorProgram(t, source)
			diagnostics := program.GetSemanticDiagnostics(t.Context(), file)
			var property, call bool
			for _, d := range diagnostics {
				property = property || d.Code() == 2339
				call = call || d.Code() == 2349
			}
			if !property || !call {
				t.Fatalf("expected native never errors: %v", diagnostics)
			}
			fs := bundled.WrapFS(osvfs.FS())
			configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")))
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			fixed := result.Files[file.FileName()]
			if fixed == nil {
				t.Fatalf("missing migration: %+v; refused: %+v", result, result.Refused)
			}
			if strings.Count(fixed.Text, "as any") != 10 || !strings.Contains(fixed.Text, "function arraySpread() { return [...(do { return 5 })] }") || !strings.Contains(fixed.Text, "const value: never = do { return 5 }") || !strings.Contains(fixed.Text, "function ordinary(value: never) { return value.missing }") {
				t.Fatalf("unexpected migration:\n%s", fixed.Text)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
			if len(again.Files) != 0 {
				t.Fatalf("migration is not idempotent: %+v", again.Files)
			}
		})
	}
}
