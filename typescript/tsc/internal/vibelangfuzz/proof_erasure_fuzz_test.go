package vibelangfuzz

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// VIP-43 (Appendix F): spec functions and proof blocks erase. A program with
// them compiles to the JavaScript and declarations of the same program
// without them, which compares the compiler with itself on two inputs the
// specification says must agree. A form in a place the specification
// rejects reports its rule.
const (
	proofErasureJSQuote        = "The emitted JavaScript is the compiler's output for the program with every theorem, spec function and proof block removed, import elision included."
	proofErasureDeclQuote      = "A checked function's declaration is the same as without its proof blocks."
	proofErasureSpecDeclQuote  = "Theorems and spec functions emit nothing."
	proofPlacementQuote        = "A proof block anywhere else, including the module top level and another proof context, is rule 4304."
	specFunctionPlacementQuote = "`theorem` and `spec function` declarations are statements of a module's top level in a `.vibe` or `.vibex` file (4301)."
	specFunctionModifierQuote  = "A modifier or overload on a theorem or spec function: `export`, `export default`, `declare`, `async`, `effect`, `*`, or an overload signature"
)

var proofErasureQuotes = []string{proofErasureJSQuote, proofErasureDeclQuote, proofErasureSpecDeclQuote, proofPlacementQuote, specFunctionPlacementQuote, specFunctionModifierQuote}

func TestProofErasureQuoted(t *testing.T) {
	for _, quote := range proofErasureQuotes {
		chapterSays(t, "900-appendices.md", quote)
	}
}

// A proofErasureCase is a program with proof forms and the same program
// without them. want is the rule a form in a rejected place breaks, or 0
// when the program is valid and must compile to the output of without.
type proofErasureCase struct {
	with, without string
	helper        bool // the project has helper.ts, which exports helper
	want          int32
}

const proofErasureHelper = "export function helper(n: number): number { return n + 1 }\n"

// proofErasureCases are the forms by key, each stating fact where a proof
// block can: valid proof blocks and spec functions, which erase, and forms in
// places the rules reject.
func proofErasureCases(fact string) map[string]proofErasureCase {
	fn := func(proof string) string {
		return "export function f(n: number): number {\n" + proof + "  let total = 0\n  for (let i = 0; i < n; i++) {\n    total += i\n  }\n  return total\n}\n"
	}
	loop := func(head, proof string) string {
		return "export function f(xs: readonly number[], n: number): number {\n  let total = 0\n  " + head + " {\n" + proof + "    total += 1\n  }\n  return total\n}\n"
	}
	spec := "spec function double(n: number): number {\n  proof {\n    decreases(n)\n  }\n  return n + n\n}\n"
	rejected := func(source string, rule int32) proofErasureCase { return proofErasureCase{with: source, want: rule} }
	return map[string]proofErasureCase{
		"proof:function-leading":    {with: fn("  proof {\n    assume(n >= 0)\n    ensures((r) => r >= 0 && " + fact + ")\n  }\n"), without: fn("")},
		"proof:after-statement":     {with: strings.Replace(fn(""), "  let total = 0\n", "  let total = 0\n  proof {\n    const m = n + 1\n    if (m > n) assert("+fact+")\n  }\n", 1), without: fn("")},
		"proof:for-leading":         {with: loop("for (let i = 0; i < n; i++)", "    proof {\n      invariant(0 <= i && "+fact+")\n      decreases(n - i)\n    }\n"), without: loop("for (let i = 0; i < n; i++)", "")},
		"proof:while-leading":       {with: loop("while (total < n)", "    proof {\n      invariant(total <= n)\n      decreases(n - total)\n    }\n"), without: loop("while (total < n)", "")},
		"proof:for-of-leading":      {with: loop("for (const x of xs)", "    proof {\n      invariant("+fact+")\n    }\n"), without: loop("for (const x of xs)", "")},
		"proof:nested-block":        {with: "export function f(n: number): number {\n  if (n > 0) {\n    proof {\n      assert(" + fact + ")\n    }\n    return n\n  }\n  return 0\n}\n", without: "export function f(n: number): number {\n  if (n > 0) {\n    return n\n  }\n  return 0\n}\n"},
		"proof:switch-case":         {with: "export function f(n: number): number {\n  switch (n) {\n    case 1:\n      proof {\n        assert(" + fact + ")\n      }\n      return 2\n  }\n  return n\n}\n", without: "export function f(n: number): number {\n  switch (n) {\n    case 1:\n      return 2\n  }\n  return n\n}\n"},
		"proof:only-statement":      {with: "export function f(n: number): void {\n  proof {\n    assert(" + fact + ")\n  }\n}\n", without: "export function f(n: number): void {\n}\n"},
		"proof:import-only":         {with: "import { helper } from \"./helper.js\"\nexport function f(n: number): number {\n  proof {\n    assert(helper(n) === helper(n) && " + fact + ")\n  }\n  return n\n}\n", without: "import { helper } from \"./helper.js\"\nexport function f(n: number): number {\n  return n\n}\n", helper: true},
		"spec:first":                {with: spec + fn("  proof {\n    ensures((r) => r >= 0 || double(n) === n + n)\n  }\n"), without: fn("")},
		"spec:last":                 {with: fn("") + spec, without: fn("")},
		"spec:between":              {with: "export const one = 1\n" + spec + "export const two = 2\n", without: "export const one = 1\nexport const two = 2\n"},
		"spec:mutual":               {with: "spec function even(n: number): boolean {\n  proof {\n    assume(n >= 0)\n    decreases(n)\n  }\n  return n === 0 ? true : odd(n - 1)\n}\nspec function odd(n: number): boolean {\n  proof {\n    assume(n >= 0)\n    decreases(n)\n  }\n  return n === 0 ? false : even(n - 1)\n}\n" + fn(""), without: fn("")},
		"spec:import-only":          {with: "import { helper } from \"./helper.js\"\nspec function lifted(n: number): number {\n  return helper(n)\n}\n" + fn("  proof {\n    ensures((r) => lifted(r) === lifted(r))\n  }\n"), without: "import { helper } from \"./helper.js\"\n" + fn(""), helper: true},
		"spec:script":               {with: "spec function double(n: number): number {\n  return n + n\n}\nfunction f(n: number): number {\n  proof {\n    ensures((r) => r === double(n) - n)\n  }\n  return n\n}\n", without: "function f(n: number): number {\n  return n\n}\n"},
		"proof:top-level":           rejected("proof {\n  assert(true)\n}\nexport const one = 1\n", 4304),
		"proof:arrow":               rejected("export const f = (n: number): number => {\n  proof {\n    assert(n === n)\n  }\n  return n\n}\n", 4304),
		"proof:function-expression": rejected("export const f = function (n: number): number {\n  proof {\n    assert(n === n)\n  }\n  return n\n}\n", 4304),
		"proof:nested-function":     rejected("export function f(n: number): number {\n  function g(): number {\n    proof {\n      assert(n === n)\n    }\n    return n\n  }\n  return g()\n}\n", 4304),
		"proof:class-method":        rejected("export class C {\n  f(n: number): number {\n    proof {\n      assert(n === n)\n    }\n    return n\n  }\n}\n", 4304),
		"proof:object-method":       rejected("export const o = {\n  f(n: number): number {\n    proof {\n      assert(n === n)\n    }\n    return n\n  },\n}\n", 4304),
		"proof:effect-function":     rejected("export effect function f(n: number) {\n  proof {\n    assert(n === n)\n  }\n  return n\n}\n", 4304),
		"proof:async-function":      rejected("export async function f(n: number): Promise<number> {\n  proof {\n    assert(n === n)\n  }\n  return n\n}\n", 4304),
		"proof:generator":           rejected("export function* f(n: number): Generator<number> {\n  proof {\n    assert(n === n)\n  }\n  yield n\n}\n", 4304),
		"proof:nested-proof":        rejected("export function f(n: number): number {\n  proof {\n    proof {\n      assert(n === n)\n    }\n  }\n  return n\n}\n", 4304),
		"proof:if-body":             rejected("export function f(n: number): number {\n  if (n > 0) proof {\n    assert(n > 0)\n  }\n  return n\n}\n", 4304),
		"proof:overloaded":          rejected("export function f(n: number): number\nexport function f(n: number): number {\n  proof {\n    assert(n === n)\n  }\n  return n\n}\n", 4304),
		"spec:export":               rejected("export spec function f(n: number): number {\n  return n\n}\n", 4302),
		"spec:export-default":       rejected("export default spec function f(n: number): number {\n  return n\n}\n", 4302),
		"spec:declare":              rejected("declare spec function f(n: number): number\nexport const one = 1\n", 4302),
		"spec:async":                rejected("spec async function f(n: number): Promise<number> {\n  return n\n}\nexport const one = 1\n", 4302),
		"spec:effect":               rejected("spec effect function f(n: number) {\n  return n\n}\nexport const one = 1\n", 4302),
		"spec:generator":            rejected("spec function* f(n: number): Generator<number> {\n  yield n\n}\nexport const one = 1\n", 4302),
		"spec:function-body":        rejected("export function f(n: number): number {\n  spec function g(m: number): number {\n    return m\n  }\n  return n\n}\n", 4301),
		"spec:block":                rejected("{\n  spec function g(m: number): number {\n    return m\n  }\n}\nexport const one = 1\n", 4301),
		"spec:namespace":            rejected("namespace N {\n  spec function g(m: number): number {\n    return m\n  }\n}\nexport const one = 1\n", 4301),
	}
}

// proofErasureFacts are verification expressions a proof block states; the
// fuzz input picks one, so each form is tried with several.
var proofErasureFacts = []string{"n === n", "n >= 0 || n < 0", "[n].every((x) => x === n)", "!(n !== n)", "Math.floor(n / 2) <= n || n < 0"}

func FuzzProofErasure(f *testing.F) {
	startShortBudget(f)
	for _, quote := range proofErasureQuotes {
		chapterSays(f, "900-appendices.md", quote)
	}
	keys := []string{}
	for key := range proofErasureCases("") {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, rest := keyedChoice(keys, data)
		key := keys[choice]
		fact := proofErasureFacts[0]
		if len(rest) > 0 {
			fact = proofErasureFacts[int(rest[0])%len(proofErasureFacts)]
		}
		c := proofErasureCases(fact)[key]
		mapperErases(t, key, c)
		project := func(source string) Project {
			p := Single(source)
			if c.helper {
				p.Files["helper.ts"] = proofErasureHelper
			}
			return p
		}
		with, err := w.Compile(context.Background(), project(c.with))
		if err != nil {
			t.Fatal(err)
		}
		defer with.Remove()
		var errors []int32
		for _, d := range with.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d.Code())
			}
		}
		if c.want != 0 {
			if !slices.Contains(errors, c.want) || slices.ContainsFunc(errors, func(code int32) bool { return code != c.want }) {
				Gap(t, "FuzzProofErasure", key, "%s / %s; want only rule %d, got %v\n%s", proofPlacementQuote, specFunctionPlacementQuote, c.want, Keys(with.Dir, with.Diagnostics), c.with)
			}
			ExpectPending(t, "FuzzProofErasure", key)
			return
		}
		if len(errors) > 0 {
			Gap(t, "FuzzProofErasure", key, "a valid program with proof forms; got %v\n%s", Keys(with.Dir, with.Diagnostics), c.with)
			ExpectPending(t, "FuzzProofErasure", key)
			return
		}
		without, err := w.Compile(context.Background(), project(c.without))
		if err != nil {
			t.Fatal(err)
		}
		defer without.Remove()
		for _, output := range []string{"out/main.js", "out/main.d.ts"} {
			if with.Outputs[output] != without.Outputs[output] {
				Gap(t, "FuzzProofErasure", key, "%s %s\n%s differs:\n%s\nwithout the proof forms:\n%s\nsource:\n%s", proofErasureJSQuote, proofErasureDeclQuote, output, with.Outputs[output], without.Outputs[output], c.with)
			}
		}
		for _, word := range proofErasureWords {
			if strings.Contains(with.Outputs["out/main.js"], word) && !strings.Contains(c.without, word) {
				Gap(t, "FuzzProofErasure", key, "%s main.js holds %q:\n%s", proofErasureJSQuote, word, with.Outputs["out/main.js"])
			}
		}
		ExpectPending(t, "FuzzProofErasure", key)
	})
}

// proofErasureWords are names that only proof syntax in the cases uses.
var proofErasureWords = []string{"spec", "proof", "assume", "ensures", "invariant", "decreases", "double", "lifted", "even", "odd"}

// mapperErases checks the TypeScript 7 mapper's JavaScript for c, keyed
// mapper:key: the proof syntax renders as nothing TypeScript rejects, and a
// valid program emits what the program without its proof forms emits.
func mapperErases(t *testing.T, key string, c proofErasureCase) {
	t.Helper()
	ctx := vibelangmapper.FileContext{FileName: "/app/src/main.vibe", ModuleKey: "app/src/main"}
	js, _, diagnostics := vibelangmapper.Emit(c.with, ctx)
	for _, d := range diagnostics {
		if d.Code == vibelangmapper.CodeExecSyntax {
			Gap(t, "FuzzProofErasure", "mapper:"+key, "%s the mapper's rendering does not parse: %s\n%s", proofErasureJSQuote, d.Message, c.with)
		}
	}
	for _, word := range proofErasureWords {
		if strings.Contains(js, word) && !strings.Contains(c.without, word) {
			Gap(t, "FuzzProofErasure", "mapper:"+key, "%s the mapper's main.js holds %q:\n%s", proofErasureJSQuote, word, js)
		}
	}
	if c.want != 0 {
		return
	}
	if want, _, _ := vibelangmapper.Emit(c.without, ctx); js != want {
		Gap(t, "FuzzProofErasure", "mapper:"+key, "%s the mapper's main.js differs:\n%s\nwithout the proof forms:\n%s\nsource:\n%s", proofErasureJSQuote, js, want, c.with)
	}
}
