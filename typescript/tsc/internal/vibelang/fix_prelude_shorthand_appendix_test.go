package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Appendix B, "Transitional compiler diagnostics": the prelude shorthand
// migration writes Scope.Scope, Option.Option<A> and
// FileSystem.FileSystem.of(impl), and the written result compiles.
// Appendix B: prelude shorthand migration — spec-rule: docs/design/src/900-appendices.md#0f69b1b1b29b94af
func TestFixWritesPreludeShorthandCallForms(t *testing.T) {
	source := `export type Maybe<A> = Option<A>
export function scoped(scope: Scope): Scope { return scope }
export const files = (impl: FileSystem.FileSystem) => FileSystem.of(impl)
`
	want := `export type Maybe<A> = Option.Option<A>
export function scoped(scope: Scope.Scope): Scope.Scope { return scope }
export const files = (impl: FileSystem.FileSystem) => FileSystem.FileSystem.of(impl)
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if errs := errorsOf(t, want); len(errs) != 0 {
		t.Fatalf("the written source reports %v", errs)
	}
}
