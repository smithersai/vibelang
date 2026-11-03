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

func TestFixStaleModuleSpecifiers(t *testing.T) {
	for _, resolution := range []string{"node10", "node16", "nodenext", "bundler"} {
		for _, suffix := range []bool{false, true} {
			for _, rewrite := range []bool{false, true} {
				for _, native := range []bool{false, true} {
					t.Run(resolution+map[bool]string{false: "/plain", true: "/suffix"}[suffix]+map[bool]string{false: "/keep", true: "/rewrite"}[rewrite]+map[bool]string{false: "/migrated", true: "/native"}[native], func(t *testing.T) {
						source := "export { value } from './target.ts'\nexport type T = import('./target.ts').T\nexport const literal = './target.ts'\n// import('./target.ts')\n"
						_, file, _, _ := editorProgram(t, source)
						dir := filepath.Dir(file.FileName().AsString())
						write := func(name, text string) {
							t.Helper()
							if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
								t.Fatal(err)
							}
						}
						targetName := "target"
						if suffix {
							targetName += ".native"
						}
						write(targetName+".vibe", "export const value: number = 1\nexport type T = number\n")
						if native {
							write("target.ts", "export const value: number = 2\nexport type T = string\n")
						}
						mod := "esnext"
						if resolution == "nodenext" || resolution == "node16" {
							mod = resolution
						}
						write("tsconfig.json", fmtConfigStale(mod, resolution, rewrite, suffix))
						fs := bundled.WrapFS(osvfs.FS())
						config, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
						if len(ds) > 0 {
							t.Fatal(ds)
						}
						result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
						want := source
						if !native {
							ext := ".js"
							if rewrite {
								ext = ".vibe"
							}
							want = strings.Replace(source, "from './target.ts'", "from './target"+ext+"'", 1)
							want = strings.Replace(want, "import('./target.ts').T", "import('./target"+ext+"').T", 1)
						}
						got := source
						if fixed := result.Files[file.FileName()]; fixed != nil {
							got = fixed.Text
						}
						if got != want || len(result.Refused) != 0 {
							t.Fatalf("got:\n%s\nwant:\n%s\nrefused: %+v", got, want, result.Refused)
						}
						write("main.vibe", got)
						again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
						if len(again.Files) != 0 {
							t.Fatalf("not idempotent: %+v", again)
						}
					})
				}
			}
		}
	}
}

func fmtConfigStale(mod, resolution string, rewrite, suffix bool) string {
	flag := "false"
	if rewrite {
		flag = "true"
	}
	suffixOption := ""
	if suffix {
		suffixOption = `,"moduleSuffixes":[".native",""]`
	}
	return "{\"compilerOptions\":{\"target\":\"es2022\",\"module\":\"" + mod + "\",\"moduleResolution\":\"" + resolution + "\",\"rewriteRelativeImportExtensions\":" + flag + suffixOption + ",\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"
}

func TestFixStaleModuleSpecifiersRootDirs(t *testing.T) {
	source := "export { value } from './target.ts'\n"
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.MkdirAll(filepath.Join(dir, "generated"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "generated/target.vibe"), []byte("export const value: number = 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	text := strings.Replace(fmtConfigStale("nodenext", "nodenext", true, false), `"skipLibCheck":true`, `"rootDirs":[".","generated"],"skipLibCheck":true`, 1)
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(diagnostics) != 0 {
		t.Fatal(diagnostics)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != strings.Replace(source, ".ts'", ".vibe'", 1) || len(result.Refused) != 0 {
		t.Fatalf("alternate-root source not repaired: %+v; refused %+v", fixed, result.Refused)
	}
}
