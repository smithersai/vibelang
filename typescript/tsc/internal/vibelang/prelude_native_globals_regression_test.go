package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func nativeGlobalsProgram(t *testing.T, source string, off bool) *compiler.Program {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	configPath := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out"},"files":["main.vibe"]`
	if off {
		config += `,"vibe":{"effectGlobals":false}`
	}
	config += "}"
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) > 0 || len(parsed.Errors) > 0 {
		t.Fatalf("config: %v %v", errors, parsed.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}

// VIP-6: each admissible Effect export is the native function in both directions.
func TestNativeGlobalsForkInSignature(t *testing.T) {
	p := nativeGlobalsProgram(t, `import { Effect as Native } from "effect"
export const forward: typeof Native.forkIn = forkIn
export const backward: typeof forkIn = Native.forkIn
`, false)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("global differs from native Effect.forkIn: %s", d.String())
		}
	}
}

// VIP-6: turning functions off covers runtime compatibility spellings too.
func TestNativeGlobalsDisabled(t *testing.T) {
	for _, source := range []string{
		"export const value = sync",
		"export const value = callback",
		"export const value = forkIn",
		"export const value = succeed",
		"export const value = never",
		"export const value = yieldNow",
		"export effect function f(){ return try sync(() => 1) }",
	} {
		t.Run(source, func(t *testing.T) {
			p := nativeGlobalsProgram(t, source, true)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					found = true
				}
			}
			if !found {
				t.Fatalf("disabled implicit function remained available: %s", source)
			}
		})
	}
	for _, source := range []string{
		`import { Effect } from "effect"; export const value = Effect.sync(() => 1)`,
		`const sync = 7; export const value: 7 = sync`,
	} {
		p := nativeGlobalsProgram(t, source, true)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("explicit/local control: %s", d.String())
			}
		}
	}
}
