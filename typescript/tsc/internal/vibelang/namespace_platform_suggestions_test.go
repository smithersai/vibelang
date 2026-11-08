package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-40 keeps namespaces in VibeLang; only a named module body is TypeScript.
func TestNamespacePlatformSuggestions(t *testing.T) {
	for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
		for _, name := range []string{"Process", "BrowserInfo"} {
			for _, scope := range []string{"file", "namespace", "nested", "dotted", "module", "shadow"} {
				if scope == "module" && (ext == ".ts" || ext == ".tsx") {
					continue
				}
				t.Run(fmt.Sprintf("%s/%s/%s", ext, name, scope), func(t *testing.T) {
					source := "export const value = " + name
					switch scope {
					case "namespace":
						source = "namespace App { " + source + " }"
					case "nested":
						source = "namespace App { export namespace Inner { " + source + " } }"
					case "dotted":
						source = "namespace App.Inner { " + source + " }"
					case "module":
						source = "module host { " + source + " }\nimport { value } from host; export { value }"
					case "shadow":
						source = "namespace App { const " + name + " = 1; " + source + " }"
					}
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					files["/workspace/x/src/main"+ext] = source
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[]},"files":["main` + ext + `","node_modules/@types/node/index.d.ts"]}`
					files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
					files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = "declare var process: { readonly pid: number };"
					ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
					if scope == "shadow" {
						if len(ds) != 0 {
							t.Fatalf("local binding: %v", ds)
						}
						return
					}
					if len(ds) != 1 {
						t.Fatalf("want one unresolved-name diagnostic; got %v", ds)
					}
					d := ds[0]
					native := ext == ".ts" || ext == ".tsx" || scope == "module"
					want := int32(2304)
					if native && name == "Process" {
						want = 2552
					}
					text := diagnosticWithNotes(d)
					if d.Source() != "" || d.Code() != want {
						t.Errorf("want native TS%d, got %s", want, text)
					}
					if d.File().Text()[d.Pos():d.End()] != name {
						t.Errorf("unresolved-name span changed: %s", text)
					}
					hint := strings.Contains(text, "Experimental."+name)
					if hint != !native {
						t.Errorf("experimental hint=%t, want %t: %s", hint, !native, text)
					}
					if !native && strings.Contains(text, "Did you mean 'process'") {
						t.Errorf("host global suggested in VibeLang: %s", text)
					}
				})
			}
		}
	}
}
