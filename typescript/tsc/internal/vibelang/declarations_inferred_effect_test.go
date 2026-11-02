package vibelang

import "testing"

// OpenCode's workerd entry imports Layer and calls a native helper returning an
// Effect. Merely inferring that return must not invent an Effect namespace import.
func TestDeclarationKeepsInferredEffectQualifier(t *testing.T) {
	for _, main := range []string{
		`import { Layer } from "effect"; import { make } from "./helper.js"; export const create = () => make(); export const empty = Layer.empty`,
		`import { Layer } from "effect"; import { make } from "./helper.js"; export function create() { return make() }; export const empty = Layer.empty`,
		`import { Layer } from "effect"; import { make } from "./helper.js"; export const service = { create() { return make() } }; export const empty = Layer.empty`,
	} {
		declarations := func(extension string) string {
			files := computedKeyFiles(false)
			base := "/workspace/x/src/"
			files[base+"node_modules/effect/package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./Effect":{"types":"./Effect.d.ts"},"./Layer":{"types":"./Layer.d.ts"}}}`
			files[base+"node_modules/effect/index.d.ts"] += `; export * as Layer from "./Layer.js"`
			files[base+"node_modules/effect/Effect.d.ts"] += `
export declare function succeed<A>(value: A): Effect<A>`
			files[base+"node_modules/effect/Layer.d.ts"] = `export interface Layer<A, E = never, R = never> { readonly _A: A }
export declare const empty: Layer<never>`
			files[base+"helper.ts"] = `import { Effect } from "effect"; export const make = () => Effect.succeed(1)`
			files[base+"main."+extension] = main
			files[base+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true},"files":["main.` + extension + `"]}`
			return emitDeclarations(t, files)
		}
		native, vibe := declarations("ts"), declarations("vibe")
		if native != vibe {
			t.Errorf("inferred native declaration changed\nnative:\n%s\nvibe:\n%s", native, vibe)
		}
	}
}

// The native helper rule must retain imports needed by authored names and by
// actual Effect forms; a return type alone does not make a plain function one.
func TestWrittenPreludeNamesMarkedEffect(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         bool
	}{
		{"marked function", `export const create = effect () => 1`, true},
		{"effect block", `export const value = effect { return 1 }`, true},
		{"authored module", `import { Effect } from "effect"; export const create = () => Effect.succeed(1)`, true},
		{"plain number", `export const create = () => 1`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = tc.source
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile("/workspace/x/src/main.vibe")
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			got := writtenPreludeNames(c, preludeStateOf(c), file)["Effect"]
			done()
			if got != tc.want {
				t.Errorf("Effect written=%t, want%t", got, tc.want)
			}
		})
	}
}
