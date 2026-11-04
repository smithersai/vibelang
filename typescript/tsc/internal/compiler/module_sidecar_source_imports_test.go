package compiler_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Minimized from t3code's useQueuedRunEdit: the body's declaration must not
// make the next native compilation treat a relocated output as another input.
func TestModuleBodyDeclarationSourceImports(t *testing.T) {
	for _, layout := range []string{"", ".vibe/declarations", "nested/types"} {
		for _, bodyName := range []string{"throwing", "parse"} {
			t.Run(layout+"/"+bodyName, func(t *testing.T) {
				files := map[string]any{
					"/src/package.json":  `{"type":"module"}`,
					"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"rootDir":".","rootDirs":[".",%q]},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":%q},"include":["**/*"]}`, layout, layout),
					"/src/input.vibe":    "export type Value = {readonly count: number};\nexport const count = 1;\n",
					"/src/main.vibe":     "module " + bodyName + " {\nimport type { Value } from \"./input.vibe\";\nexport function run(value: Value): Value { return value; }\n}\nexport {run} from " + bodyName + ";\n",
				}
				for round := range 3 {
					fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
					config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(ds) > 0 || len(config.Errors) > 0 {
						t.Fatalf("config: %v %v", ds, config.Errors)
					}
					p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
					for _, d := range p.GetProgramDiagnostics() {
						if d.Code() == 5055 {
							t.Fatalf("round %d: %s", round, d.String())
						}
					}
					for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
						t.Errorf("round %d: %s", round, d.String())
					}
					emitted := map[string]string{}
					r := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
					if r == nil || r.EmitSkipped || len(r.Diagnostics) > 0 {
						t.Fatalf("round %d: emit %+v", round, r)
					}
					body := emitted["/src/main.vibe."+bodyName+".d.ts"]
					if round == 0 && !strings.Contains(body, `from "./input.vibe"`) {
						t.Fatalf("body imports an output instead of its source:\n%s", body)
					}
					for name, text := range emitted {
						files[name] = text
					}
				}
			})
		}
	}
}
