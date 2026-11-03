package tsoptions

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// Ordinary declarations in hidden directories are not module-body sidecars.
// Dot lookup must never turn a directory prefix into a rooted file path.
func TestModuleBodyDeclarationPath(t *testing.T) {
	for _, name := range []string{
		"/src/input.d.ts",
		"/src/.fixtures/input.d.ts",
		"/src/.fixtures/.d.ts",
		"/src/.fixtures/input.extra.d.ts",
		"/src/.fixtures/.input.d.ts",
		"/src/.vibe/input.d.ts",
		"/src/.vibex/input.d.ts",
	} {
		t.Run(name, func(t *testing.T) {
			host := vfstest.FromMap(map[string]string{}, tspath.CaseSensitive)
			if isModuleBodyDeclaration(tspath.RootedFilePathFromNormalized(name), host) {
				t.Fatal("ordinary declaration was mistaken for a module-body sidecar")
			}
		})
	}
	for _, ext := range []string{".vibe", ".vibex"} {
		source := "/src/.fixtures/input" + ext
		host := vfstest.FromMap(map[string]string{
			source: "module named { export const value = 1 }",
		}, tspath.CaseSensitive)
		if !isModuleBodyDeclaration(tspath.RootedFilePathFromNormalized(source+".named.d.ts"), host) {
			t.Errorf("%s: generated module-body declaration was not recognized", ext)
		}
		if isModuleBodyDeclaration(tspath.RootedFilePathFromNormalized(source+".missing.d.ts"), host) {
			t.Errorf("%s: a declaration without a written module was hidden", ext)
		}
	}
}

func FuzzModuleBodyDeclarationPath(f *testing.F) {
	for _, dir := range []string{".fixtures", ".vibe", ".vibex", "a.b", "plain", "..."} {
		f.Add(dir)
	}
	f.Fuzz(func(t *testing.T, input string) {
		if len(input) > 128 {
			input = input[:128]
		}
		dir := "dir-" + strings.Map(func(r rune) rune {
			if r == '.' || r >= 'a' && r <= 'z' {
				return r
			}
			return 'x'
		}, input)
		name := "/src/" + dir + "/input.d.ts"
		host := vfstest.FromMap(map[string]string{}, tspath.CaseSensitive)
		if isModuleBodyDeclaration(tspath.RootedFilePathFromNormalized(name), host) {
			t.Fatal("ordinary declaration was mistaken for a module-body sidecar")
		}
	})
}
