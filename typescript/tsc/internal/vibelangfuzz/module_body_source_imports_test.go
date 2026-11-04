package vibelangfuzz

import (
	"fmt"
	"path"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const moduleBodySourceImportsQuote = "A compatibility sidecar is an emit output: discovery selects the source ahead of its sidecar, while an explicit `files` input keeps native overwrite protection (`TS5055`)."

func TestModuleBodySourceImportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), moduleBodySourceImportsQuote) {
		t.Fatalf("Chapter 7 no longer says %q", moduleBodySourceImportsQuote)
	}
}

// Chapter 7 distinguishes source and output identities. Mutate the source
// depth, relocated layout, module name and import shape around the minimized
// t3code helper; repeated discovery must not import an output as a new input.
func FuzzModuleBodySourceImports(f *testing.F) {
	for _, b := range []byte{0, 1, 7} {
		f.Add("source-import", b)
	}
	f.Fuzz(func(t *testing.T, key string, b byte) {
		TestModuleBodySourceImportsQuoted(t)
		if key != "source-import" && key != "t3code-use-queued-run-edit" {
			t.Skip("unknown construct key")
		}
		layout := []string{"", ".vibe/declarations", "nested/types"}[int(b)%3]
		directory := []string{"", "deep/"}[int(b>>2)%2]
		name := []string{"throwing", "parse"}[int(b>>3)%2]
		spec := "./input.vibe"
		if directory != "" {
			spec = "../input.vibe"
		}
		imp := "import type {Value} from " + fmt.Sprintf("%q", spec) + ";\n"
		typ := "Value"
		if b&16 != 0 {
			imp = "import type * as Values from " + fmt.Sprintf("%q", spec) + ";\n"
			typ = "Values.Value"
		}
		main := "/src/" + directory + "main.vibe"
		files := map[string]any{
			"/src/package.json":  `{"type":"module"}`,
			"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"noEmit":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","rootDir":".","rootDirs":[".",%q]},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":%q},"include":["**/*"]}`, layout, layout),
			"/src/input.vibe":    "export type Value = {readonly count: number};\n",
			main:                 "module " + name + " {\n" + imp + "export function run(value: " + typ + "): " + typ + " {return value;}\n}\nexport {run} from " + name + ";\n",
		}
		construct := fmt.Sprintf("source-import/%s/%s/%s/%d", layout, directory, name, b&16)
		for round := range 3 {
			fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
			config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) > 0 || len(config.Errors) > 0 {
				t.Fatalf("config: %v %v", ds, config.Errors)
			}
			p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			for _, d := range p.GetProgramDiagnostics() {
				if d.Code() == 5055 {
					Gap(t, "FuzzModuleBodySourceImports", construct, "Chapter 7: round %d imports an output: %s", round, d.String())
				}
			}
			r := p.EmitDeclarationSidecars(t.Context(), func(file, text string) error {
				if path.Base(file) == "main.vibe."+name+".d.ts" && strings.Contains(text, "declarations/input.vibe") {
					Gap(t, "FuzzModuleBodySourceImports", construct, "Chapter 7: body imports a compatibility output:\n%s", text)
				}
				files[file] = text
				return nil
			})
			if r == nil || r.EmitSkipped || len(r.Diagnostics) > 0 {
				t.Fatalf("round %d: emit %+v", round, r)
			}
		}
	})
}
