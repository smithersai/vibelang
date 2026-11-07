package compiler

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-27: "A reference to a VibeLang module targets that module's selected
// compatibility declaration." A .vibex target is such a module: however a
// .vibe file spells its import (./App.jsx, ./App.js, ./App or ./App.vibex),
// the sidecar names App.vibex's compatibility declaration, beside the source
// or relocated under vibe.sidecarDir, as it does for a .vibe target.
// rule-evidence: docs/design/vips/0039-vibex.md#83b28e1d15dc1f66
func TestSidecarNamesVibexTargetsCompatibilityDeclaration(t *testing.T) {
	t.Parallel()
	for _, layout := range []struct{ sidecarDir, sidecar string }{
		{"", "/src/main.d.vibe.ts"},
		{"decl", "/src/decl/main.d.vibe.ts"},
		{"types/nested", "/src/types/nested/main.d.vibe.ts"},
	} {
		for _, specifier := range []string{"./App.jsx", "./App.js", "./App", "./App.vibex"} {
			for _, jsx := range []string{"preserve", "react-jsx"} {
				t.Run(layout.sidecarDir+"/"+specifier+"/"+jsx, func(t *testing.T) {
					t.Parallel()
					vibe := `"effectGlobals":false,"effectModules":false`
					if layout.sidecarDir != "" {
						vibe += fmt.Sprintf(`,"sidecarDir":%q`, layout.sidecarDir)
					}
					fs := vfstest.FromMap(map[string]any{
						"/src/package.json":  `{"type":"module"}`,
						"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"noLib":true,"module":"esnext","moduleResolution":"bundler","jsx":%q,"rootDir":".","outDir":"out","declaration":true,"allowImportingTsExtensions":true,"emitDeclarationOnly":true},"vibe":{%s},"files":["main.vibe","App.vibex"]}`, jsx, vibe),
						"/src/main.vibe":     fmt.Sprintf("export { App } from %q\nexport type Shape = import(%q).Shape\n", specifier, specifier),
						"/src/App.vibex":     `export interface Shape { readonly n: number }` + "\n" + `export const App: Shape = { n: 1 }`,
					}, tspath.CaseSensitive)
					config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(diagnostics) != 0 {
						t.Fatal(diagnostics)
					}
					p := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
					written := map[string]string{}
					p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
						written[name] = text
						return nil
					})
					main, ok := written[layout.sidecar]
					if !ok {
						t.Fatalf("no sidecar at %s; wrote %v", layout.sidecar, keys(written))
					}
					want := tspath.GetRelativePathFromDirectory(tspath.GetDirectoryPath(layout.sidecar), tspath.GetDirectoryPath(layout.sidecar)+"/App.vibex", tspath.CaseSensitive)
					if !strings.HasPrefix(want, ".") {
						want = "./" + want
					}
					if _, ok := written[tspath.GetDirectoryPath(layout.sidecar)+"/App.d.vibex.ts"]; !ok {
						t.Fatalf("App.vibex's sidecar is not beside main's; wrote %v", keys(written))
					}
					if strings.Count(main, fmt.Sprintf("%q", want)) != 2 {
						t.Fatalf("sidecar does not name App.vibex's compatibility declaration as %q twice:\n%s", want, main)
					}
				})
			}
		}
	}
}

func keys(m map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

// FuzzSidecarNamesVibexTarget widens the matrix above to arbitrary module
// names, source subdirectories, import spellings and sidecar layouts. Oracle,
// VIP-27: "A reference to a VibeLang module targets that module's selected
// compatibility declaration." Both sidecars share one layout, so the sidecar
// names the .vibex source at the target's path relative to the importer's.
func FuzzSidecarNamesVibexTarget(f *testing.F) {
	f.Add("App", "", uint8(0), uint8(0), false)
	f.Add("Über", "ui", uint8(1), uint8(1), true)
	f.Add("x-1", "a/b", uint8(2), uint8(2), false)
	f.Add("view", "..", uint8(3), uint8(0), true)
	f.Fuzz(func(t *testing.T, stem string, directory string, spelling uint8, layout uint8, preserve bool) {
		if !portableName(stem) || len(stem) > 24 || (directory != "" && directory != ".." && !portablePath(directory)) || len(directory) > 24 {
			t.Skip()
		}
		spellings := []string{".jsx", ".js", "", ".vibex"}
		layouts := []string{"", "decl", "types/nested"}
		jsx := "react-jsx"
		if preserve {
			jsx = "preserve"
		}
		target := "/src/" + stem + ".vibex"
		specifier := "./" + stem + spellings[int(spelling)%len(spellings)]
		if directory == ".." {
			target = "/src/" + stem + ".vibex"
			specifier = "../" + stem + spellings[int(spelling)%len(spellings)]
		} else if directory != "" {
			target = "/src/" + directory + "/" + stem + ".vibex"
			specifier = "./" + directory + "/" + stem + spellings[int(spelling)%len(spellings)]
		}
		main := "/src/main.vibe"
		if directory == ".." {
			main = "/src/sub/main.vibe"
		}
		vibe := `"effectGlobals":false,"effectModules":false`
		sidecarDir := layouts[int(layout)%len(layouts)]
		if sidecarDir != "" {
			vibe += fmt.Sprintf(`,"sidecarDir":%q`, sidecarDir)
		}
		files := map[string]any{
			"/src/package.json":  `{"type":"module"}`,
			"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"noLib":true,"module":"esnext","moduleResolution":"bundler","jsx":%q,"rootDir":".","outDir":"out","declaration":true,"allowImportingTsExtensions":true,"emitDeclarationOnly":true},"vibe":{%s},"files":[%q,%q]}`, jsx, vibe, strings.TrimPrefix(main, "/src/"), strings.TrimPrefix(target, "/src/")),
			main:                 fmt.Sprintf("export { value } from %q\n", specifier),
			target:               "export const value = 1\n",
		}
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(diagnostics) != 0 {
			t.Skip()
		}
		p := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
		written := map[string]string{}
		p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
			written[name] = text
			return nil
		})
		mirror := func(source string) string {
			if sidecarDir == "" {
				return source
			}
			return "/src/" + sidecarDir + "/" + strings.TrimPrefix(source, "/src/")
		}
		sidecar, ok := written[strings.TrimSuffix(mirror(main), ".vibe")+".d.vibe.ts"]
		if !ok {
			t.Fatalf("no sidecar for %s; wrote %v", main, keys(written))
		}
		want := tspath.GetRelativePathFromDirectory(tspath.GetDirectoryPath(mirror(main)), mirror(target), tspath.CaseSensitive)
		if !strings.HasPrefix(want, ".") {
			want = "./" + want
		}
		if !strings.Contains(sidecar, fmt.Sprintf("%q", want)) {
			t.Fatalf("%s from %s (sidecarDir %q, jsx %s): sidecar does not name %q:\n%s", specifier, main, sidecarDir, jsx, want, sidecar)
		}
	})
}

func portableName(s string) bool {
	if s == "" || strings.EqualFold(s, "index") || strings.EqualFold(s, "main") || strings.HasPrefix(s, ".") {
		return false
	}
	for _, r := range s {
		if !(r == '-' || r == '_' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= 0xC0 && r < 0x250) {
			return false
		}
	}
	return true
}

func portablePath(s string) bool {
	for _, part := range strings.Split(s, "/") {
		if !portableName(part) || part == "out" || part == "decl" || part == "types" || part == "sub" {
			return false
		}
	}
	return true
}
