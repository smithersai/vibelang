package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestDeclarationKeepsAssertedReturnAlias(t *testing.T) {
	for _, form := range []string{"arrow", "function", "expression", "method"} {
		t.Run(form, func(t *testing.T) {
			emit := func(extension, annotation string) string {
				files := computedKeyFiles(false)
				base := "/workspace/x/src/"
				files[base+"schema.ts"] = "export interface Shape { readonly kind: string }; export declare function create(): Shape"
				body := "compact(create()) as ReturnType<typeof create>"
				declaration := ""
				switch form {
				case "arrow":
					declaration = "export const advertised = ()" + annotation + " => " + body
				case "function":
					declaration = "export function advertised()" + annotation + " { return " + body + " }"
				case "expression":
					declaration = "export const advertised = function()" + annotation + " { return " + body + " }"
				case "method":
					declaration = "export const service = { advertised()" + annotation + " { return " + body + " } }"
				}
				files[base+"main."+extension] = "import { create } from \"./schema.js\"; const compact = (value: unknown): unknown => value; " + declaration
				files[base+"tsconfig.json"] = fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","lib":["esnext"],"module":"NodeNext","declaration":true},"files":["main.%s"]}`, extension)
				return emitDeclarations(t, files)
			}
			native := emit("ts", "")
			if !strings.Contains(native, "ReturnType<typeof create>") {
				t.Fatalf("native control lost assertion: %s", native)
			}
			for _, annotation := range []string{"", ": infer _", ": ReturnType<typeof create>"} {
				actual := emit("vibe", annotation)
				if !strings.Contains(actual, "ReturnType<typeof create>") {
					t.Errorf("return annotation %q lost asserted alias\nnative:\n%s\nvibe:\n%s", annotation, native, actual)
				}
			}
		})
	}
}
