package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestNativeMetaGrammar(t *testing.T) {
	for _, source := range []string{
		"import.x;", "export const value = import.x;", "import.x = 1;",
		"import.source;", "import.defer;", "import.x.url;", "(import.x).url;",
		"export const value = import.x[\"url\"];",
		"export function read() { return import.x; }",
		"export function read() { return import.source; }",
		"import\n.x;", "new.foo;",
		"export function load(specifier: string) { return import.source(specifier); }",
		"export function load(specifier: string) { return import.defer(specifier); }",
	} {
		for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
			t.Run(source+"/"+ext, func(t *testing.T) {
				read := func(extension string) []string {
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					files["/workspace/x/src/main"+extension] = source
					module, resolution := "NodeNext", "NodeNext"
					if strings.Contains(source, "specifier") {
						module, resolution = "ESNext", "Bundler"
					}
					files["/workspace/x/src/tsconfig.json"] = fmt.Sprintf(`{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ESNext","module":%q,"moduleResolution":%q,"types":[],"lib":["ESNext","DOM"]},"files":["main%s"]}`, module, resolution, extension)
					p := computedKeyProgram(t, files)
					ds := append([]*ast.Diagnostic{}, p.GetSyntacticDiagnostics(t.Context(), nil)...)
					ds = append(ds, p.GetSemanticDiagnostics(t.Context(), nil)...)
					var result []string
					for _, d := range ds {
						result = append(result, fmt.Sprintf("%s%d:%d:%d:%v", d.Source(), d.Code(), d.Pos(), d.End(), d.Category()))
					}
					slices.Sort(result)
					return result
				}
				native := read(".ts")
				if !strings.Contains(source, "specifier") && len(native) == 0 {
					t.Fatal("invalid native form had no diagnostic")
				}
				if strings.Contains(source, "specifier") && len(native) != 0 {
					t.Fatalf("native phase-call control failed: %v", native)
				}
				got := read(ext)
				if !slices.Equal(got, native) {
					t.Fatalf("native grammar diagnostics changed: want %v, got %v", native, got)
				}
				for _, d := range got {
					if strings.HasPrefix(d, "EK") {
						t.Errorf("invalid meta-property is not a platform use: %s", d)
					}
				}
			})
		}
	}
}
