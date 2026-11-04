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

// Chapter 007, "Legacy prelude shorthand": the transitional compiler accepts
// a module's name written for its same-named export, and every --fix scope
// writes the export: Option<A> becomes Option.Option<A>, FileSystem.of
// becomes FileSystem.FileSystem.of, a bare Scope type becomes Scope.Scope,
// and a written qualified export such as Experimental.Process.Process is
// kept, never shortened. A second run writes nothing.
func TestFixWritesPreludeShorthandExports(t *testing.T) {
	source := `export type Maybe = Option<number>
export const some = Option.some(1)
export const noop = FileSystem.of
export function scoped(s: Scope): number { return 1 }
export const running = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)
export const key = FileSystem.FileSystem
`
	want := `export type Maybe = Option.Option<number>
export const some = Option.some(1)
export const noop = FileSystem.FileSystem.of
export function scoped(s: Scope.Scope): number { return 1 }
export const running = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)
export const key = FileSystem.FileSystem
`
	for _, scope := range []struct {
		name    string
		options FixOptions
	}{{"fix", FixOptions{}}, {"migration-only", FixOptions{MigrationOnly: true}}, {"vip-only", FixOptions{VIPOnly: true}}} {
		t.Run(scope.name, func(t *testing.T) {
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
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, scope.options)
			fixed := result.Files[file.FileName()]
			if fixed == nil || fixed.Text != want {
				got := ""
				if fixed != nil {
					got = fixed.Text
				}
				t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
				t.Fatal(err)
			}
			if again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, scope.options); len(again.Order) != 0 {
				t.Errorf("a second --fix changed %v", again.Order)
			}
		})
	}
}
