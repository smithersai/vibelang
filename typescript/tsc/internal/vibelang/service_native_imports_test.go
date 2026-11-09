package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestServiceNativeImports(t *testing.T) {
	for _, phase := range []string{"source", "defer"} {
		for _, form := range []string{"function", "arrow", "async", "namespace", "argument"} {
			for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
				t.Run(phase+"/"+form+"/"+ext, func(t *testing.T) {
					arg := "specifier"
					if form == "argument" {
						arg = "42"
					}
					source := "export function load(specifier: string) { return import." + phase + "(" + arg + "); }"
					switch form {
					case "arrow":
						source = "export const load = (specifier: string) => import." + phase + "(" + arg + ");"
					case "async":
						source = "export async function load(specifier: string) { return import." + phase + "(" + arg + "); }"
					case "namespace":
						source = "namespace App { " + source + " }"
					}
					read := func(extension string) []*ast.Diagnostic {
						files := computedKeyFiles(false)
						delete(files, "/workspace/x/src/main.vibe")
						files["/workspace/x/src/main"+extension] = source
						files["/workspace/x/src/tsconfig.json"] = fmt.Sprintf("{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"ESNext\",\"module\":\"ESNext\",\"moduleResolution\":\"Bundler\",\"types\":[],\"lib\":[\"ESNext\",\"DOM\"]},\"files\":[\"main%s\"]}", extension)
						p := computedKeyProgram(t, files)
						ds := append([]*ast.Diagnostic{}, p.GetSyntacticDiagnostics(t.Context(), nil)...)
						return append(ds, p.GetSemanticDiagnostics(t.Context(), nil)...)
					}
					native := read(".ts")
					got := read(ext)
					for _, d := range got {
						if d.Source() == "EK" && d.Code() == 9214 {
							t.Fatalf("native import was classified as a service-key call: %s", d.String())
						}
					}
					for _, want := range native {
						if !slices.ContainsFunc(got, func(d *ast.Diagnostic) bool {
							return d.Source() == want.Source() && d.Code() == want.Code() && d.Pos() == want.Pos() && d.End() == want.End() && d.Category() == want.Category()
						}) {
							t.Fatalf("native diagnostic lost: %s; got %v", want.String(), got)
						}
					}
				})
			}
		}
	}
}
