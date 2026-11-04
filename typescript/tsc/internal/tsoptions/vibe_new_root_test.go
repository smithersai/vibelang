package tsoptions

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A file vibelang --fix creates is a root once written exactly when the
// include specs take it and the exclude specs do not; a files-only config
// takes no new file (t3code apps/desktop: include ["src"], composite).
func TestIncludesNewFile(t *testing.T) {
	for _, tc := range []struct {
		config string
		want   map[string]bool
	}{
		{`{"include":["src"],"exclude":["src/gen"]}`, map[string]bool{"src/a.platform-12.ts": true, "src/deep/b.ts": true, "src/gen/c.ts": false, "other/d.ts": false}},
		{`{"include":["src/**/*.ts"]}`, map[string]bool{"src/a.ts": true, "src/a.js": false}},
		{`{"files":["src/main.ts"]}`, map[string]bool{"src/a.ts": false}},
	} {
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, "src"), 0755); err != nil {
			t.Fatal(err)
		}
		for name, text := range map[string]string{"tsconfig.json": tc.config, "src/main.ts": "export {}\n"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		config, errs := GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, osvfs.FS(), nil)
		if len(errs) != 0 {
			t.Fatal(errs)
		}
		for name, want := range tc.want {
			if got := config.IncludesNewFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, name)))); got != want {
				t.Errorf("%s: IncludesNewFile(%s) = %v, want %v", tc.config, name, got, want)
			}
		}
	}
}
