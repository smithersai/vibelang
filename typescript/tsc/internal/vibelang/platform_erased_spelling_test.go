package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestPlatformErasedSpelling(t *testing.T) {
	for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
		for _, row := range []struct{ name, typo, member string }{
			{"process", "proces", "pid"}, {"document", "documnt", "title"}, {"Buffer", "Buffe", "value"},
		} {
			for _, form := range []string{"query", "tuple", "qualified", "value", "valid"} {
				t.Run(fmt.Sprintf("%s/%s/%s", ext, row.name, form), func(t *testing.T) {
					source := "export type Read = typeof " + row.typo
					switch form {
					case "tuple":
						source = "export type Read = [typeof " + row.typo + "]"
					case "qualified":
						source += "." + row.member
					case "value":
						source = "export const read = " + row.typo
					case "valid":
						source = "export type Read = typeof " + row.name
					}
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					files["/workspace/x/src/main"+ext] = source
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[]},"files":["main` + ext + `","node_modules/@types/node/index.d.ts"]}`
					files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
					files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = "declare var process: {readonly pid:number}; declare var Buffer: {readonly value:number};"
					ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
					if form == "valid" {
						if len(ds) != 0 {
							t.Fatalf("valid erased host read: %v", ds)
						}
						return
					}
					if len(ds) != 1 {
						t.Fatalf("invalid typo fixture: %v", ds)
					}
					d := ds[0]
					allowed := form != "value" || ext == ".ts" || ext == ".tsx"
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
						t.Errorf("missing native suggestion: %s", d.String())
					}
				})
			}
		}
	}
}
