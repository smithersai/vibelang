package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// Project declarations keep TypeScript's spelling suggestions even when their
// name is also used by a banned host global. Host declarations remain controls.
func TestPlatformSpellingProjectGlobals(t *testing.T) {
	for _, name := range []struct{ name, typo string }{
		{"process", "proces"}, {"fetch", "fetcn"}, {"Buffer", "Bffer"}, {"document", "documen"},
	} {
		for _, origin := range []string{"project", "host", "local", "typescript"} {
			t.Run(name.name+"/"+origin, func(t *testing.T) {
				files := computedKeyFiles(false)
				source := "export const value = " + name.typo
				declaration := fmt.Sprintf("declare var %s: { readonly value: number }", name.name)
				declFile := "globals.d.ts"
				if origin == "host" {
					declFile = "node_modules/@types/node/index.d.ts"
					files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
				}
				file := "main.vibe"
				if origin == "typescript" {
					file = "main.ts"
				}
				if origin == "local" {
					source = fmt.Sprintf("const %s = {value:1}; %s", name.name, source)
					declaration = "export {}"
				}
				files["/workspace/x/src/"+declFile] = declaration
				files["/workspace/x/src/"+file] = source
				files["/workspace/x/src/tsconfig.json"] = fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","lib":["ESNext"],"module":"NodeNext","types":[],"noEmit":true},"files":[%q,%q]}`, file, declFile)
				ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
				want := int32(2552)
				if origin == "host" {
					want = 2304
				}
				if len(ds) != 1 || ds[0].Source() != "" || ds[0].Code() != want {
					t.Fatalf("want native TS%d, got %v", want, ds)
				}
				if want == 2552 && !strings.Contains(ds[0].String(), "Did you mean") {
					t.Fatalf("missing native suggestion: %s", ds[0].String())
				}
			})
		}
	}
}
