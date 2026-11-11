package vibelang

import (
	"strings"
	"testing"
)

// A namespace's type shorthand is source sugar. A foreign inferred type must
// retain the interface's qualification in ordinary TypeScript declarations.
func TestDeclarationShadowedNamespaceType(t *testing.T) {
	for _, binding := range []string{
		"import type { SqlClient } from \"effect/sql\"",
		"import { SqlClient } from \"effect/sql\"",
		"import type * as SqlClient from \"effect/sql/SqlClient\"",
		"import * as SqlClient from \"effect/sql/SqlClient\"",
		"import type { SqlClient as Client } from \"effect/sql\"",
		"import type { SqlClient } from \"effect/sql/SqlClient\"",
	} {
		t.Run(binding, func(t *testing.T) {
			emit := func(ext string) string {
				files := computedKeyFiles(false)
				base := "/workspace/x/src/"
				files[base+"node_modules/effect/package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./Effect":{"types":"./Effect.d.ts"},"./sql":{"types":"./sql/index.d.ts"},"./sql/SqlClient":{"types":"./sql/SqlClient.d.ts"}}}`
				files[base+"node_modules/effect/sql/index.d.ts"] = `export * as SqlClient from "./SqlClient.js"`
				files[base+"node_modules/effect/sql/SqlClient.d.ts"] = `export interface SqlClient { readonly query: string } export declare const marker: unique symbol`
				files[base+"helper.ts"] = `import type { SqlClient } from "effect/sql/SqlClient"; export declare const plain: () => { $client: SqlClient }`
				name := "SqlClient"
				if strings.Contains(binding, "as Client") {
					name = "Client"
				}
				annotation := name + ".SqlClient"
				if strings.Contains(binding, "{ SqlClient } from \"effect/sql/SqlClient\"") {
					annotation = name
				}
				files[base+"main."+ext] = binding + "; import { plain } from \"./helper.js\"; const plained = plain(); export type Plained = typeof plained; export type Named = " + annotation
				files[base+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.` + ext + `"]}`
				return emitDeclarations(t, files)
			}
			native, vibe := emit("ts"), emit("vibe")
			if native != vibe {
				t.Errorf("declarations differ\nTypeScript:\n%s\nVibeLang:\n%s", native, vibe)
			}
		})
	}
}
