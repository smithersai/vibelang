package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestPlatformTypeSpelling(t *testing.T) {
	for _, row := range []struct{ name, typo string }{{"FileReader", "FileReaderr"}, {"WebSocket", "WebSockeet"}, {"XMLHttpRequest", "XMLHttpRequst"}} {
		for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
			for _, form := range []string{"type", "array", "generic", "interface", "implements", "extends", "value", "query", "valid-type"} {
				t.Run(fmt.Sprintf("%s/%s/%s", row.name, ext, form), func(t *testing.T) {
					source := "export type Value = " + row.typo
					switch form {
					case "array":
						source += "[]"
					case "generic":
						source = "export type Value = Array<" + row.typo + ">"
					case "interface":
						source = "export interface Value extends " + row.typo + " {}"
					case "implements":
						source = "export class Value implements " + row.typo + " {}"
					case "extends":
						source = "export class Value extends " + row.typo + " {}"
					case "value":
						source = "export const value = " + row.typo
					case "query":
						source = "export type Value = typeof " + row.typo
					case "valid-type":
						source = "export type Value = " + row.name
					}
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					files["/workspace/x/src/main"+ext] = source
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[],"lib":["ESNext","DOM"]},"files":["main` + ext + `"]}`
					ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
					if form == "valid-type" {
						if len(ds) != 0 {
							t.Fatalf("valid erased type: %v", ds)
						}
						return
					}
					if len(ds) != 1 {
						t.Fatalf("invalid fixture: %v", ds)
					}
					d := ds[0]
					allowed := ext == ".ts" || ext == ".tsx" || (form != "value" && form != "extends")
					want := int32(2304)
					if allowed {
						want = 2552
					}
					if d.Source() != "" || d.Code() != want || d.Category() != errorCategory {
						t.Errorf("want native TS%d, got %s", want, d.String())
					}
					if d.File().Text()[d.Pos():d.End()] != row.typo {
						t.Errorf("typo span changed: %s", d.String())
					}
					if allowed && !strings.Contains(d.String(), "Did you mean '"+row.name+"'") {
						t.Errorf("native suggestion missing: %s", d.String())
					}
				})
			}
		}
	}
}
