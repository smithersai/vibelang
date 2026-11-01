package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const declarationPreludeModesQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func requireDeclarationPreludeModesQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), declarationPreludeModesQuote) {
		t.Fatal("chapter 1 declaration identity quote changed")
	}
}
func TestDeclarationPreludeModesQuoted(t *testing.T) { requireDeclarationPreludeModesQuote(t) }

// VIP-27 permits this compiler-self comparison: ordinary TypeScript has the
// explicit imports that the prelude supplies to VibeLang. Compare raw .d.ts
// bytes, including import style, across emit kinds and package defaults.
// NodeNext stays ESM here; its cross-mode assertion requirement is independent
// of Preserve/Bundler and is not relaxed by the product fix.
func FuzzDeclarationPreludeModes(f *testing.F) {
	startShortBudget(f)
	requireDeclarationPreludeModesQuote(f)
	keys := []string{"layer", "context", "option", "schema", "pair", "shadow", "block", "block-try", "block-service", "function", "function-sleep", "layer-block"}
	for _, mode := range []string{"Preserve", "ESNext", "NodeNext"} {
		for _, key := range keys {
			f.Add(mode, key, uint8(0))
			if mode != "NodeNext" {
				f.Add(mode, key, uint8(1))
				f.Add(mode, key, uint8(2))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode, key string, pkg uint8) {
		resolution := "Bundler"
		switch mode {
		case "Preserve", "ESNext":
		case "NodeNext":
			resolution = "NodeNext"
			pkg = 0
		default:
			return
		}
		// twin is the Effect TypeScript body when it differs from the VibeLang
		// source. Chapter 1: "A form that stands for a module writes its name:
		// an Effect function, ... or a bare Effect global such as sleep writes
		// Effect, which its Effect TypeScript imports." An effect block is
		// Effect.gen (VIP-2), so each twin declares Effect.Effect<...>.
		imports, source, twin := "", "", ""
		switch key {
		case "layer":
			imports = "Layer"
			source = "export const value = Layer.merge(Layer.empty, Layer.empty)\n"
		case "context":
			imports = "Context, References"
			source = "export const value = Context.add(Context.empty(), References.MinimumLogLevel, \"Info\")\n"
		case "option":
			imports = "Option"
			source = "export const value = Option.some(1)\n"
		case "schema":
			imports = "Schema"
			source = "export const value = Schema.String\n"
		case "pair":
			imports = "Layer, Option"
			source = "export const value = [Layer.empty, Option.some(1)] as const\n"
		case "block":
			// t3code PullRequestProviderRegistry.ts: an exported Effect.gen value
			// declared import("effect/Effect").Effect after migration.
			imports = "Effect"
			source = "export const value = effect { return 1 }\n"
			twin = "export const value = Effect.gen(function* () { return 1 })\n"
		case "block-try":
			imports = "Effect"
			source = "export const value = effect { const n = try Effect.succeed(1); return n + 1 }\n"
			twin = "export const value = Effect.gen(function* () { const n = yield* Effect.succeed(1); return n + 1 })\n"
		case "block-service":
			imports = "Context, Effect"
			service := "export class Drivers extends Context.Service<Drivers, { readonly kinds: ReadonlyArray<string> }>()(\"Drivers\") {}\n"
			source = service + "export const value = effect { const drivers = try Drivers; return drivers.kinds.length }\n"
			twin = service + "export const value = Effect.gen(function* () { const drivers = yield* Drivers; return drivers.kinds.length })\n"
		case "function":
			imports = "Effect"
			source = "export effect function value() { return 1 }\n"
			twin = "export function value() { return Effect.gen(function* () { return 1 }) }\n"
		case "function-sleep":
			// A bare Effect global runs only inside a program, so it sits in
			// an Effect function body here.
			imports = "Effect"
			source = "export effect function value() { try sleep(\"1 second\"); return 1 }\n"
			twin = "export function value() { return Effect.gen(function* () { yield* Effect.sleep(\"1 second\"); return 1 }) }\n"
		case "layer-block":
			imports = "Context, Effect, Layer"
			service := "export class Drivers extends Context.Service<Drivers, { readonly n: number }>()(\"Drivers\") {}\n"
			source = service + "export const value = Layer.effect(Drivers, effect { return { n: 1 } })\n"
			twin = service + "export const value = Layer.effect(Drivers, Effect.gen(function* () { return { n: 1 } }))\n"
		case "shadow":
			source = "const Layer = { empty: 1 }; export const value = Layer.empty\n"
		default:
			return
		}
		packageText := []string{`{"type":"module"}`, `{"type":"commonjs"}`, `{}`}[int(pkg)%3]
		original := source
		if twin != "" {
			original = twin
		}
		if imports != "" {
			original = "import { " + imports + " } from \"effect\"\n" + original
		}
		compile := func(name, text string) *Result {
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","singleThreaded":true,"module":%q,"moduleResolution":%q,"strict":true,"types":[],"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":[%q]}`, mode, resolution, name)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{name: text, "package.json": packageText}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Program.Options().SingleThreaded.IsTrue() {
				t.Fatal("declaration identity must disable parallel emit on both inputs")
			}
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzDeclarationPreludeModes", fmt.Sprintf("%s/%s/%d", mode, key, pkg%3), "unexpected diagnostic in %s: %v", name, d)
				}
			}
			return result
		}
		vibe := compile("main.vibe", source)
		defer vibe.Remove()
		native := compile("main.ts", original)
		defer native.Remove()
		declaration := func(result *Result) string {
			for name, text := range result.Outputs {
				if strings.HasSuffix(name, "/main.d.ts") {
					return text
				}
			}
			t.Fatal("missing main declaration")
			return ""
		}
		got, want := declaration(vibe), declaration(native)
		if got != want {
			Gap(t, "FuzzDeclarationPreludeModes", fmt.Sprintf("%s/%s/%d", mode, key, pkg%3), "module=%s package=%s\nVibeLang:\n%s\nTypeScript:\n%s", mode, packageText, got, want)
		}
	})
}
