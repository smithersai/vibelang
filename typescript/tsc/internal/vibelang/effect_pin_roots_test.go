package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestEffectPinPackageAnchorRoots(t *testing.T) {
	for _, test := range []struct {
		key, file, root string
	}{
		{"drive", "c:/proj/main.vibe", "c:/"},
		{"drive-root", "c:/main.vibe", "c:/"},
		{"untitled", "^/untitled/ts-nul-authority/Untitled-1", "^/"},
		{"posix", "/proj/main.vibe", "/"},
	} {
		t.Run(test.key, func(t *testing.T) {
			for _, manifest := range []string{"absent", "root", "nearest"} {
				t.Run(manifest, func(t *testing.T) {
					name := tspath.RootedFilePathFromAbsolute(test.file)
					files := map[string]string{test.file: "export const n = 1"}
					want := ""
					if manifest != "absent" {
						want = test.root + "package.json"
						files[want] = `{"name":"root-package"}`
					}
					if manifest == "nearest" {
						want = name.Directory().ResolveFile("package.json").AsString()
						files[want] = `{"name":"nearest-package"}`
					}
					fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
					config := tsoptions.NewParsedCommandLine(&core.CompilerOptions{
						NoLib: core.TSTrue, NoEmit: core.TSTrue, AllowNonTsExtensions: core.TSTrue,
					}, []tspath.RootedFilePath{name}, nil, name.Directory(), fs.CaseSensitivity())
					p := compiler.NewProgram(compiler.ProgramOptions{
						Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
						SingleThreaded: core.TSTrue,
					})
					file := p.GetSourceFile(name)
					if file == nil {
						t.Fatal("missing source file")
					}
					anchor := effectPinPackageAnchor(p, file)
					got := ""
					if anchor != nil {
						got = anchor.FileName().AsString()
					}
					if got != want {
						t.Fatalf("manifest anchor %q, want %q", got, want)
					}
					// Exercise the program-level diagnostic hook used by CLI
					// and language-server inferred projects, even without a mismatch.
					if ds := effectPinDiagnostics(p); len(ds) != 0 {
						t.Fatalf("no Effect installed, got project diagnostics %v", ds)
					}
				})
			}
		})
	}
}
