package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A contextual Effect.fn contract is the Effect type of the checked call,
// which TypeScript infers with the context, rather than the context's own
// type. When the context also feeds inference, as under satisfies or a
// generic parameter, its wider types would otherwise become the inferred and
// declared type. Each want is in the declaration stock TypeScript 5.9.3 writes
// for the source before --fix; each avoid is the context's wider type.
func TestEffectFnContextualContractKeepsCheckedChannels(t *testing.T) {
	const prelude = `export class A extends Context.Service<A, { readonly n: number }>()("A") {}
export class B extends Context.Service<B, { readonly m: number }>()("B") {}
export class Missing extends Data.TaggedError("Missing")<{}> {}
export class Denied extends Data.TaggedError("Denied")<{}> {}
export interface Plugin<E, R> { readonly id: string; readonly effect: (ctx: string) => Effect.Effect<void, E, R> }
export function define<E, R>(plugin: Plugin<E, R>): Plugin<E, R> { return plugin }
export type Wide = Plugin<Missing | Denied, A | B | Scope.Scope>
export interface Info { readonly directory: string; readonly branch?: string }
export interface Strategy { readonly create: (name: string) => Effect.Effect<Info, unknown>; readonly list: () => Effect.Effect<ReadonlyArray<Info>> }
`
	for _, tc := range []struct{ name, source, want, avoid string }{
		{"satisfies a wider requirement", `export const P = define({
  id: "p",
  effect: Effect.fn("P")(function* (ctx) {
    const a = yield* A
    if (a.n > ctx.length) return
  }),
} satisfies Wide)
`, "export declare const P: Plugin<never, A>;", ""},
		{"satisfies a wider error", `export const P = define({
  id: "p",
  effect: Effect.fn("P")(function* (ctx) {
    if (ctx === "") return yield* new Missing()
  }),
} satisfies Wide)
`, "export declare const P: Plugin<Missing, never>;", ""},
		{"satisfies a wider success type", `export const S = {
  create: Effect.fn("create")(function* (name: string) {
    yield* Effect.void
    return { directory: name }
  }),
  list: Effect.fn("list")(function* () {
    yield* Effect.void
    return [{ directory: "a" }]
  }),
} satisfies Strategy
`, "directory: string;", "Effect.Effect<Info"},
		{"annotated holder keeps its annotation", `export const run: (ctx: string) => Effect.Effect<void, Missing | Denied, A | B> = Effect.fn("run")(function* (ctx) {
  const a = yield* A
  if (a.n > ctx.length) return
})
`, "export declare const run: (ctx: string) => Effect.Effect<void, Missing | Denied, A | B>;", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixed, result := fixedPipe(t, prelude+tc.source)
			if strings.Contains(fixed, "function*") {
				t.Fatalf("generator remains:\n%s\nrefusals: %+v", fixed, result.Refused)
			}
			_, file, _, _ := editorProgram(t, fixed)
			dir := filepath.Dir(file.FileName().AsString())
			config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
				t.Fatal(err)
			}
			var declarations strings.Builder
			for _, text := range migrationRuleDeclarations(t, dir, nil) {
				declarations.WriteString(text)
			}
			// The declared constant follows the prelude's own declarations.
			exported := declarations.String()
			if at := strings.Index(exported, "export declare const "); at >= 0 {
				exported = exported[at:]
			}
			if !strings.Contains(exported, tc.want) || tc.avoid != "" && strings.Contains(exported, tc.avoid) {
				t.Fatalf("declaration lost %q or names %q:\n%s\nfixed:\n%s", tc.want, tc.avoid, declarations.String(), fixed)
			}
		})
	}
}
