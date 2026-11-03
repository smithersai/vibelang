package vibelang

import "testing"

// VIP-27's declaration content contract follows the TypeScript counterpart:
// a local export does not import a library namespace of the same spelling.
func TestDeclarationInferredQualifierHygiene(t *testing.T) {
	for _, binding := range []string{
		`export const SchemaAST = "local";`,
		`export type SchemaAST = string;`,
		`export namespace SchemaAST { export type Local = string }`,
	} {
		t.Run(binding, func(t *testing.T) {
			declarations := func(extension string) string {
				files := computedKeyFiles(false)
				base := "/workspace/x/src/"
				effect := base + "node_modules/effect/"
				files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./Schema":{"types":"./Schema.d.ts"},"./SchemaAST":{"types":"./SchemaAST.d.ts"},"./Effect":{"types":"./Effect.d.ts"}}}`
				files[effect+"index.d.ts"] += `; export * as Schema from "./Schema.js"; export * as SchemaAST from "./SchemaAST.js"`
				files[effect+"SchemaAST.d.ts"] = `export interface ParseOptions { readonly errors?: "first" | "all" }`
				files[effect+"Schema.d.ts"] = `import * as SchemaAST from "./SchemaAST.js"; export declare const String: unknown; export declare function decodeUnknownSync(schema: unknown): (input: unknown, options?: SchemaAST.ParseOptions) => string;`
				files[base+"main."+extension] = `import { Schema as Codec } from "effect"; ` + binding + ` export const decode = Codec.decodeUnknownSync(Codec.String);`
				files[base+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.` + extension + `"]}`
				return emitDeclarations(t, files)
			}
			native, vibe := declarations("ts"), declarations("vibe")
			if native != vibe {
				t.Errorf("local name captured inferred library qualifier\nnative:\n%s\nvibe:\n%s", native, vibe)
			}
		})
	}
}

// Shorthand denotes the library binding as a value, even though the checker
// also gives the property's name a separate symbol.
func TestDeclarationPreludeShorthandQualifier(t *testing.T) {
	declarations := func(extension string) string {
		files := computedKeyFiles(false)
		base := "/workspace/x/src/"
		source := "export const modules = { Effect };"
		if extension == "ts" {
			source = `import { Effect } from "effect"; ` + source
		}
		files[base+"main."+extension] = source
		files[base+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.` + extension + `"]}`
		return emitDeclarations(t, files)
	}
	native, vibe := declarations("ts"), declarations("vibe")
	if native != vibe {
		t.Errorf("library shorthand lost its qualifier\nnative:\n%s\nvibe:\n%s", native, vibe)
	}
}
