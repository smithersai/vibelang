package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A contextual Effect.fn contract keeps its success type, which types the
// body's return expressions, but takes its error and requirement channels from
// the checked call. When the contextual type also feeds inference, as under
// satisfies or a generic parameter, its wider channels would otherwise
// become the inferred and declared type. Each want is the declaration stock
// TypeScript 5.9.3 writes for the source before --fix.
func TestEffectFnContextualContractKeepsCheckedChannels(t *testing.T) {
	const prelude = `export class A extends Context.Service<A, { readonly n: number }>()("A") {}
export class B extends Context.Service<B, { readonly m: number }>()("B") {}
export class Missing extends Data.TaggedError("Missing")<{}> {}
export class Denied extends Data.TaggedError("Denied")<{}> {}
export interface Plugin<E, R> { readonly id: string; readonly effect: (ctx: string) => Effect.Effect<void, E, R> }
export function define<E, R>(plugin: Plugin<E, R>): Plugin<E, R> { return plugin }
export type Wide = Plugin<Missing | Denied, A | B | Scope.Scope>
`
	for _, tc := range []struct{ name, source, want string }{
		{"satisfies a wider requirement", `export const P = define({
  id: "p",
  effect: Effect.fn("P")(function* (ctx) {
    const a = yield* A
    if (a.n > ctx.length) return
  }),
} satisfies Wide)
`, "export declare const P: Plugin<never, A>;"},
		{"satisfies a wider error", `export const P = define({
  id: "p",
  effect: Effect.fn("P")(function* (ctx) {
    if (ctx === "") return yield* new Missing()
  }),
} satisfies Wide)
`, "export declare const P: Plugin<Missing, never>;"},
		{"annotated holder keeps its annotation", `export const run: (ctx: string) => Effect.Effect<void, Missing | Denied, A | B> = Effect.fn("run")(function* (ctx) {
  const a = yield* A
  if (a.n > ctx.length) return
})
`, "export declare const run: (ctx: string) => Effect.Effect<void, Missing | Denied, A | B>;"},
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
			if !strings.Contains(declarations.String(), tc.want) {
				t.Fatalf("declaration lost %q:\n%s\nfixed:\n%s", tc.want, declarations.String(), fixed)
			}
		})
	}
}
