package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-5 / decided details 88 and 36: syntax does not narrow the operand test.
// The types and expected side come from Chapter 2, not compiler observations.
const trySubtypeNegativeQuote = "`Option`, `Result`, `Stream`, `Layer` and `Fiber` do not pass the Effect operand test."

const trySubtypeQuote = "`e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`."

func TestTrySubtypeShapesQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{trySubtypeQuote, trySubtypeNegativeQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
}

func FuzzTrySubtypeShapes(f *testing.F) {
	startShortBudget(f)
	rules := []migrationOperandRule{
		{"config", "declare const input: Config.Config<string>;", true},
		{"exit", "declare const input: Exit.Exit<number, string>;", true},
		{"inherited", `interface Sub extends Effect.Effect<number, string> { readonly tag: "Sub" }; declare const input: Sub;`, true},
		{"branded", `declare const input: Effect.Effect<number, string> & { readonly brand: "Sub" };`, true},
		{"option", "declare const input: Option.Option<number>;", false},
		{"result", "declare const input: Result.Result<number, string>;", false},
		{"stream", "declare const input: Stream.Stream<number>;", false},
		{"layer", "declare const input: Layer.Layer<never>;", false},
		{"fiber", "declare const input: Fiber.Fiber<number>;", false},
	}
	for _, rule := range rules {
		for shape := uint8(0); shape < 24; shape++ {
			f.Add(rule.key, shape)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestTrySubtypeShapesQuoted(t)
		i := slices.IndexFunc(rules, func(r migrationOperandRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		rule := rules[i]
		shapes := []string{"call", "bound", "alias", "generic"}
		setup := []string{"", "const bound = make();", "const alias = make;", ""}
		operands := []string{"make()", "bound", "alias()", "identity(make())"}
		n := int(shape % 4)
		mode := int(shape/4) % 6
		if rule.key == "config" && mode == 0 {
			setup = []string{"", `const bound = Config.String("FOLDKIT_REPRO_VALUE");`, "const alias = Config.String;", ""}
			operands = []string{`Config.String("FOLDKIT_REPRO_VALUE")`, "bound", `alias("FOLDKIT_REPRO_VALUE")`, `identity(Config.String("FOLDKIT_REPRO_VALUE"))`}
		}
		factory := "/** @throws {never} */ declare function make(): typeof input;\n"
		header := "export effect function probe()"
		if mode == 1 {
			factory = "/** @throws {never} */ declare function make<T extends typeof input>(): T;\n"
			header = "export effect function probe<T extends typeof input>()"
			setup = []string{"", "const bound = make<T>();", "const alias = make;", ""}
			operands = []string{"make<T>()", "bound", "alias<T>()", "identity(make<T>())"}
			shapes = []string{"constrained-call", "constrained-bound", "constrained-alias", "constrained-generic"}
		}
		if mode == 2 {
			factory = `type Deferred<U> = U extends string ? typeof input : typeof input & { readonly extra: "Branch" };` + "\n" +
				"/** @throws {never} */ declare function make<U>(): Deferred<U>;\n"
			header = "export effect function probe<U>()"
			setup = []string{"", "const bound = make<U>();", "const alias = make;", ""}
			operands = []string{"make<U>()", "bound", "alias<U>()", "identity(make<U>())"}
			shapes = []string{"conditional-call", "conditional-bound", "conditional-alias", "conditional-generic"}
		}
		if mode == 3 {
			factory = "interface Container { readonly task: typeof input };\n" +
				"/** @throws {never} */ declare function make<T extends Container>(): T[\"task\"];\n"
			header = "export effect function probe<T extends Container>()"
			setup = []string{"", "const bound = make<T>();", "const alias = make;", ""}
			operands = []string{"make<T>()", "bound", "alias<T>()", "identity(make<T>())"}
			shapes = []string{"indexed-call", "indexed-bound", "indexed-alias", "indexed-generic"}
		}
		if mode == 4 {
			factory = "/** @throws {never} */ declare function make<T extends typeof input, U extends typeof input>(): T | U;\n"
			header = "export effect function probe<T extends typeof input, U extends typeof input>()"
			setup = []string{"", "const bound = make<T, U>();", "const alias = make;", ""}
			operands = []string{"make<T, U>()", "bound", "alias<T, U>()", "identity(make<T, U>())"}
			shapes = []string{"union-call", "union-bound", "union-alias", "union-generic"}
		}
		if mode == 5 {
			factory = `/** @throws {never} */ declare function make<T extends typeof input>(): T & { readonly extra: "Branch" };` + "\n"
			header = "export effect function probe<T extends typeof input>()"
			setup = []string{"", "const bound = make<T>();", "const alias = make;", ""}
			operands = []string{"make<T>()", "bound", "alias<T>()", "identity(make<T>())"}
			shapes = []string{"intersection-call", "intersection-bound", "intersection-alias", "intersection-generic"}
		}
		source := `import { Config, Effect, Exit, Option, Result, Stream, Layer, Fiber } from "effect";` + "\n" +
			rule.declarations + "\n" + factory +
			"/** @throws {never} */ function identity<T>(value: T): T { return value }\n" +
			header + " { " + setup[n] + " return try " + operands[n] + " }\n" +
			strings.Replace(header, "probe", "probeStatement", 1) + " { " + setup[n] + " try " + operands[n] + "; return 0 }"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []string
		rejected := 0
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				if d.Source() == "EK" && d.Code() == 502 {
					rejected++
				}
			}
		}
		gapKey := "feature:" + rule.key + ":" + shapes[n]
		if rule.allowed && len(errors) != 0 || !rule.allowed && rejected < 2 {
			Gap(t, "FuzzTrySubtypeShapes", gapKey, "Chapter 2: %q; accepts=%t; got %v\n%s", trySubtypeQuote, rule.allowed, errors, source)
		}
		ExpectPending(t, "FuzzTrySubtypeShapes", gapKey)
		ExpectPending(t, "FuzzTrySubtypeShapes", specCorpusKey(t))
	})
}
