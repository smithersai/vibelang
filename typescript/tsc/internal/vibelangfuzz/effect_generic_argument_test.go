package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const effectGenericArgumentTarget = "FuzzPlainGenericEffectArgumentDiagnostics"
const effectGenericArgumentQuote = "In effect code, a plain call whose own inferred type argument is an Effect reports `EK4802` at each argument that uses that type parameter outside a declared Effect position."
const effectGenericExplicitQuote = "Writing the call's type arguments explicitly opts out: `expect<Effect.Effect<number>>(e)` passes the program as data."

func TestEffectGenericArgumentQuoted(t *testing.T) {
	text := SpecText("002-running.md")
	for _, quote := range []string{effectGenericArgumentQuote, effectGenericExplicitQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
}

// declared: the type parameter's constraint names an Effect, as Effect's
// duals `<Arg extends Effect<any, any, any> | Options>` do, so the argument
// stands in a declared Effect position and no mode reports EK4802.
type effectGenericShape struct {
	key, declaration, callee, argument, repaired string
	declared                                     bool
}

func effectGenericShapes() []effectGenericShape {
	return []effectGenericShape{
		{"smithers-expect-awaited", "function expect<T>(actual: T, message?: string): number { return 1 }", "expect", "awaited(p)", "try awaited(p)", false},
		{"direct-first", "function take<T>(x: T, n: number): number { return n }", "take", "e, 1", "try e, 1", false},
		{"direct-last", "function take<T>(n: number, x: T): number { return n }", "take", "1, e", "1, try e", false},
		{"array", "function take<T>(x: T[]): number { return 1 }", "take", "[e]", "[try e]", false},
		{"promise", "function take<T>(x: Promise<T>): number { return 1 }", "take", "p", "valuePromise", false},
		{"unknown-constraint", "function take<T extends unknown>(x: T): number { return 1 }", "take", "e", "try e", false},
		{"overloads", "function take<T>(x: T): number; function take(x: unknown): number { return 1 }", "take", "e", "try e", false},
		{"object-method", "const box = { take<T>(x: T): number { return 1 } }", "box.take", "e", "try e", false},
		{"callback-parameter", "", "callback", "e", "try e", false},
		{"callback-result", "function take<T>(x: () => T): number { return 1 }", "take", "() => e", "() => 1", false},
		{"effect-constraint", "function take<T extends Effect.Effect<any, any, any>>(x: T): number { return 1 }", "take", "e", "e", true},
		{"union-constraint", "function take<T extends Effect.Effect<any, any, any> | { readonly n?: number } | undefined>(x?: T): number { return 1 }", "take", "e", "e", true},
	}
}

// Static VIP-1/5 ambiguity check, keyed by shape. Each seed checks the bad
// inference and both explicit repairs; the TypeScript twin is an acceptance control.
func FuzzPlainGenericEffectArgumentDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := effectGenericShapes()
	for _, shape := range shapes {
		for mode := range 4 {
			f.Add(shape.key, uint8(mode))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, home uint8) {
		TestEffectGenericArgumentQuoted(t)
		index := slices.IndexFunc(shapes, func(s effectGenericShape) bool { return s.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(shapes)
		}
		shape := shapes[index]
		mode := []string{"inferred", "explicit", "run", "instantiated"}[int(home)%4]
		key = shape.key + ":" + mode
		args, types, callee := shape.argument, "", shape.callee
		if mode == "explicit" {
			types = "<Effect.Effect<number>>"
		}
		if mode == "instantiated" {
			callee = "(" + callee + "<Effect.Effect<number>>)"
		}
		if mode == "run" {
			args = shape.repaired
		}
		source := shape.declaration + "\ndeclare function awaited(p: Promise<Effect.Effect<number>>): Effect.Effect<number>;\nexport effect function probe(e: Effect.Effect<number>, p: Promise<Effect.Effect<number>>, callback: <T>(x: T) => number, valuePromise: Promise<number>) { return " + callee + types + "(" + args + ") }\n"
		var result *Result
		var err error
		within(t, "check inferred generic Effect argument", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Code() == 4802 {
				count++
			}
		}
		want := 0
		if mode == "inferred" && !shape.declared {
			want = 1
		}
		if count != want || HasError(result.Diagnostics) {
			Gap(t, effectGenericArgumentTarget, key, "VIP-1/5: want %d EK4802 diagnostics, got %d (%v)\n%s", want, count, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, effectGenericArgumentTarget, key)
		ExpectPending(t, effectGenericArgumentTarget, specCorpusKey(t))
	})
}
