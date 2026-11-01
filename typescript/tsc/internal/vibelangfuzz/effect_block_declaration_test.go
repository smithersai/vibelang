package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// An effect block is Effect.gen (VIP-2), so the module that writes one writes
// Effect, as its Effect TypeScript twin imports it, even when the prelude
// supplies Effect and the source never names it. Chapter 1: "Declarations are
// exactly what idiomatic Effect TypeScript would declare." The declaration
// names Effect.Effect<...>, not import("effect/Effect").Effect<...>. t3code's
// PullRequestProviderRegistry.ts lost its Effect import to the codemod, which
// left only effect blocks (drive-t3code-server 2026-11-01T21:06Z,
// declaration:effect-namespace-vs-inline-import). This compares the compiler
// with itself on a VibeLang module and its twin, as VIP-27 permits.
func TestEffectBlockDeclarationNamesEffect(t *testing.T) {
	requireDeclarationPreludeModesQuote(t)
	service := "export class Drivers extends Context.Service<Drivers, { readonly n: number }>()(\"Drivers\") {}\n"
	forms := []struct{ key, imports, source, twin string }{
		{"block", "Effect", "export const value = effect { return 1 }\n",
			"export const value = Effect.gen(function* () { return 1 })\n"},
		{"block-try", "Effect", "export const value = effect { const n = try Effect.succeed(1); return n + 1 }\n",
			"export const value = Effect.gen(function* () { const n = yield* Effect.succeed(1); return n + 1 })\n"},
		{"block-service", "Context, Effect", service + "export const value = effect { const drivers = try Drivers; return drivers.n }\n",
			service + "export const value = Effect.gen(function* () { const drivers = yield* Drivers; return drivers.n })\n"},
		{"layer-block", "Context, Effect, Layer", service + "export const value = Layer.effect(Drivers, effect { return { n: 1 } })\n",
			service + "export const value = Layer.effect(Drivers, Effect.gen(function* () { return { n: 1 } }))\n"},
		{"object-block", "Effect", "export const value = { run: effect { return 1 } }\n",
			"export const value = { run: Effect.gen(function* () { return 1 }) }\n"},
		{"default-block", "Effect", "export default effect { return 1 }\n",
			"export default Effect.gen(function* () { return 1 })\n"},
		{"function-control", "Effect", "export effect function value() { return 1 }\n",
			"export function value() { return Effect.gen(function* () { return 1 }) }\n"},
	}
	w := NewWorkspace(t)
	for _, mode := range []string{"Preserve", "ESNext", "NodeNext"} {
		resolution := "Bundler"
		if mode == "NodeNext" {
			resolution = "NodeNext"
		}
		for _, form := range forms {
			t.Run(mode+"/"+form.key, func(t *testing.T) {
				compile := func(name, text string) string {
					config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","singleThreaded":true,"module":%q,"moduleResolution":%q,"strict":true,"types":[],"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":[%q]}`, mode, resolution, name)
					result, err := w.Compile(t.Context(), Project{Files: map[string]string{name: text, "package.json": `{"type":"module"}`}, Config: config})
					if err != nil {
						t.Fatal(err)
					}
					defer result.Remove()
					for _, d := range result.Diagnostics {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("%s: %v", name, d)
						}
					}
					for output, text := range result.Outputs {
						if strings.HasSuffix(output, "/main.d.ts") {
							return text
						}
					}
					t.Fatalf("%s: no main.d.ts", name)
					return ""
				}
				got := compile("main.vibe", form.source)
				want := compile("main.ts", "import { "+form.imports+" } from \"effect\"\n"+form.twin)
				if got != want {
					t.Errorf("VibeLang:\n%s\nTypeScript:\n%s", got, want)
				}
			})
		}
	}
}
