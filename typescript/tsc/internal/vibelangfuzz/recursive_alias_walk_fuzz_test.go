package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestRecursiveAliasEffectRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), effectDeclaredParameterQuote) {
		t.Fatalf("chapter 2 no longer says %q", effectDeclaredParameterQuote)
	}
}

func FuzzRecursiveAliasEffectArguments(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), effectDeclaredParameterQuote) {
		f.Fatalf("chapter 2 no longer says %q", effectDeclaredParameterQuote)
	}
	type probe struct {
		key, definitions, parameters, arguments string
		want                                    int
	}
	probes := []probe{
		{"branching-array", "type Tree<U> = Tree<U[]>[] | Tree<[U]>[]; function take<T>(x: T, n: Tree<number>): number { return 0 }", "n: Tree<number>", "e, n", 1},
		{"array-parameter", "type Nested<U> = Nested<U[]>[]; function take<T>(x: T, n: Nested<number>): number { return 0 }", "n: Nested<number>", "e, n", 1},
		{"array-constraint", "type Nested<U> = Nested<U[]>[]; function take<A extends Nested<number>, T>(n: A, x: T): number { return 0 }", "n: Nested<number>", "n, e", 1},
		{"parameter", "type Next<U> = { next: Next<U[]> }; function take<T>(x: T, n: Next<number>): number { return 0 }", "n: Next<number>", "e, n", 1},
		{"constraint", "type Next<U> = { next: Next<U[]> }; function take<A extends Next<number>, T>(n: A, x: T): number { return 0 }", "n: Next<number>", "n, e", 1},
		{"builder", "type Builder<A extends unknown[]> = { add<U>(u: U): Builder<[...A, U]>; done(): A }; function take<T>(x: T, b: Builder<[]>): number { return 0 }", "b: Builder<[]>", "e, b", 1},
		{"payload", "type Next<U> = { next: Next<U[]>; value: U }; function take<T>(x: Next<T>): number { return 0 }", "n: Next<Effect.Effect<never>>", "n", 1},
		{"declared", "type Next<U> = { next: Next<U[]>; run: Effect.Effect<U> }; function take<T>(x: Next<T>): number { return 0 }", "n: Next<number>", "n", 0},
		{"nested", "type Box<U> = { value: U }; function take<T>(x: Box<Box<Box<Box<T>>>>): number { return 0 }", "n: Box<Box<Box<Box<Effect.Effect<never>>>>>", "n", 1},
	}
	for _, p := range probes {
		f.Add([]byte(p.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if string(data) == p.key {
				index = i
				break
			}
		}
		p := probes[index]
		source := p.definitions + "\nexport effect function probe(e: Effect.Effect<never>, " + p.parameters + ") { const result = take(" + p.arguments + "); return 0 }"
		if len(data) > 1 && data[1]%2 == 1 {
			source = strings.ReplaceAll(source, "; ", ";\r\n")
		}
		if len(data) > 2 && data[2]%2 == 1 {
			source = "/* recursive contract */\n" + source
		}
		// Chapter 2 requires the advisory for an inferred bare parameter,
		// and exempts a contract that already declares Effect data.
		native := "import { Effect } from \"effect\"\n" + strings.Replace(source, "export effect function", "export function", 1)
		control, err := w.Compile(t.Context(), Project{Files: map[string]string{"control.ts": native}})
		if err != nil {
			t.Fatal(err)
		}
		defer control.Remove()
		if HasError(control.Diagnostics) {
			Gap(t, "FuzzRecursiveAliasEffectArguments", "native:"+p.key, "native counterpart must typecheck: %v\\n%s", SortedKeys(Keys(control.Dir, control.Diagnostics)), native)
			return
		}
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4802 {
				count++
			}
		}
		if HasError(result.Diagnostics) || count != p.want {
			Gap(t, "FuzzRecursiveAliasEffectArguments", "advisory:"+p.key, "want %d EK4802 and no errors, got %v\\n%s", p.want, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
	})
}
