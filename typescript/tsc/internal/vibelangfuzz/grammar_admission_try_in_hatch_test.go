package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// VIP-6 replaces the legacy hatches, so `sync` is no special prelude form and
// its callback is plain code, where Chapter 2 makes `try` EK0501. The arrows
// that Effect's own wrappers take are plain code too: VIP-6 says no language
// feature wraps TypeScript into an Effect. The compiler once read the first
// argument of a call to the prelude's `sync`, and the function that
// `Effect.try`, `Effect.tryPromise` or the global `tryPromise` wraps, as
// TypeScript where `try` meant nothing: it skipped EK0501 there and emitted
// the callback without the `try`, so the callback returned the Effect unrun.
// These tests keep that rejected: the former witnesses, and a generated
// neighbourhood of every wrapper, callback shape, try form and enclosing code.
const (
	grammarTryInHatchVIPQuote     = "D148's hatches (`sync`, `try`, `callback` as special prelude forms) and D229's no-capture rule."
	grammarTryInHatchWrapperQuote = "No language feature wraps TypeScript into an Effect. You use Effect's own functions (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TS."
	grammarTryInHatchRuleQuote    = "| `try` outside effect code; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | `EK0501` |"
	grammarTryInHatchInnerQuote   = "a plain arrow written inside an `effect` function is a plain function, and `try` is an error inside it."
)

func TestGrammarAdmissionTryInHatchQuoted(t *testing.T) {
	vip := SpecText("../vips/0006-effect-globals.md")
	if !strings.Contains(vip, grammarTryInHatchVIPQuote) {
		t.Fatal("VIP-6 no longer replaces the sync hatch; review admission:try-in-hatch")
	}
	if !strings.Contains(vip, grammarTryInHatchWrapperQuote) {
		t.Fatal("VIP-6 no longer says Effect's wrappers take ordinary arrows; review admission:try-in-hatch")
	}
	if !strings.Contains(SpecText("002-running.md"), grammarTryInHatchRuleQuote) {
		t.Fatal("Chapter 2's EK0501 row changed; review admission:try-in-hatch")
	}
	tryInWrapperCallbackQuoted(t)
}

func tryInWrapperCallbackQuoted(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("001-functions.md"), grammarTryInHatchInnerQuote) {
		tb.Fatalf("001-functions.md no longer says %q", grammarTryInHatchInnerQuote)
	}
	if !strings.Contains(SpecText("002-running.md"), grammarTryInHatchRuleQuote) {
		tb.Fatalf("002-running.md no longer says %q", grammarTryInHatchRuleQuote)
	}
	if !strings.Contains(SpecText("005-services.md"), "No language feature wraps TypeScript into an Effect.") {
		tb.Fatal("005-services.md no longer says Effect's wrappers are ordinary functions")
	}
}

// grammarBalancedEnd returns the index of the first token at or after start
// that ends the item there: a "," at the same depth, or a closing bracket
// with no opener since start; len(ts) when none.
func grammarBalancedEnd(ts []grammarToken, start int) int {
	depth := 0
	for j := start; j < len(ts); j++ {
		switch ts[j].text {
		case "(", "[", "{":
			depth++
		case ")", "]", "}":
			if depth == 0 {
				return j
			}
			depth--
		case ",":
			if depth == 0 {
				return j
			}
		}
	}
	return len(ts)
}

const grammarTryInHatchWitness = "import { Effect } from \"effect\"\nfunction f() { return sync(() => try Effect.succeed(1)) }"

// The case-seeded campaign mutated hatch-promise-shapes this way.
const grammarTryInHatchCaseWitness = "export effect function main() { const r: number = try sync((flag: boolean): number | Promise<number> => try flag ? Promise.resolve(1) : 2, true); return r }"

// A try in the function Effect.try wraps, inside an effect function.
const grammarTryInHatchWrapperWitness = "import { Effect } from \"effect\"\nexport effect function main() { const b = try Effect.try(() => try Effect.succeed(1)); return b }"

// The case-seeded campaign put a try inside the callback that
// ek0402-own-signature-target passes to Effect.try; the compiler reports only
// the missing foreign module.
const grammarTryInHatchWrapperCaseWitness = `import { probe as probe$platform } from "./foreign.ts"
export const probe : typeof probe$platform = probe$platform
const identity = < T > ( x : T ) : T => x
const viaIdentity = identity ( probe$platform )
const statics = Object . assign ( { } , { probe : probe$platform } )
const Row = Schema . Struct ( { id : Schema . String } )
const RowStatics = Object . assign ( { } , { make : Row . make } )
export effect function main ( ) {
const a = try Effect . try ( ( ) => probe ( "a" ) )
const b = try Effect . try ( ( ) => try viaIdentity ( "b" ) )
const c = try Effect . try ( ( ) => statics . probe ( "c" ) )
const row = try Effect . try ( ( ) => RowStatics . make ( { id : "x" } ) )
const failed = try Effect . try ( ( ) => probe ( "" ) ) . pipe ( Effect . isFailure )
return [ a , b , c , row . id , failed ]
}`

// grammarTryInHatchFixed are the programs that once compiled with the try
// dropped. Each now reports EK0501.
var grammarTryInHatchFixed = []string{
	grammarTryInHatchWitness,
	grammarTryInHatchCaseWitness,
	"export effect function main() { return sync(() => try 1) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => { const v = try Effect.succeed(1); return v }) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => try.all [Effect.succeed(1)]) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(function () { return try Effect.succeed(1) }) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => [1].map(() => try Effect.succeed(1))) }",
	grammarTryInHatchWrapperWitness,
	grammarTryInHatchWrapperCaseWitness,
	"import { Effect } from \"effect\"\nfunction f() { return Effect.try(() => try Effect.succeed(1)) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try Effect.tryPromise(() => try Effect.succeed(1)) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try tryPromise(() => try Effect.succeed(1)) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try Effect.try({ try: () => try Effect.succeed(1), catch: (e) => e }) }",
}

func tryInHatchErrors(t *testing.T, w *Workspace, source string) []string {
	t.Helper()
	r, err := w.Compile(context.Background(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	_, errs := advisoryCodes(r.Diagnostics)
	return errs
}

// Retained selectors and saved corpus keys keep reaching the same rules.
func TestGrammarAdmissionTryInHatchKeys(t *testing.T) {
	names := tryInWrapperCallbackNames()
	for want, name := range names {
		if got := advisoryPick([]byte("key:"+name), names); got != want {
			t.Errorf("key %q selected %d, want %d", name, got, want)
		}
	}
	for _, source := range grammarTryInHatchFixed {
		if got := grammarAdmissionForm(source); got == "admission:try-in-hatch" {
			t.Errorf("fixed witness still selects the retired gap: %q", source)
		}
	}
}

func TestGrammarAdmissionTryInHatchRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(slices.Clone(grammarTryInHatchFixed),
		"export effect function main() { return try Effect.try(function () { return try 1 }) }",
		"export effect function main() { return try Effect.try((() => try Effect.succeed(1))) }",
	) {
		t.Run(source, func(t *testing.T) {
			if errs := tryInHatchErrors(t, w, source); !slices.Contains(errs, "EK0501") {
				t.Fatalf("a try in a wrapped callback is outside effect code, but the compiler gives %v", errs)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("the rejected program is an admission gap again")
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// The issue's program: both callbacks once returned an unrun Effect.
	issue := "export effect function main() { const a = try sync(() => try succeed(1)); const b = try Effect.try(() => try succeed(2)); return [a, b] }"
	if errs := tryInHatchErrors(t, w, issue); !slices.Equal(errs, []string{"EK0501", "EK0501"}) {
		t.Errorf("want EK0501 at each callback's try, got %v", errs)
	}
	// A wrapper's later arguments, other callees and shadowed names always had the rule.
	for _, source := range []string{
		"export effect function main() { const f = () => try Effect.succeed(1); return f }",
		"export effect function main() { return sync((n: number) => n, () => try Effect.succeed(1)) }",
		"function sync(f: () => number) { return f() }\nexport effect function main() { return sync(() => try Effect.succeed(1)) }",
		"export effect function main() { return try Effect.map(Effect.succeed(1), () => try Effect.succeed(1)) }",
		"export effect function main() { return try Effect.try({ try: () => 1, catch: () => try Effect.succeed(1) }) }",
	} {
		if errs := tryInHatchErrors(t, w, source); !slices.Contains(errs, "EK0501") {
			t.Errorf("control lost EK0501, got %v: %q", errs, source)
		}
	}
	// No try in the callback, or an explicit effect function there: no EK0501.
	for _, source := range []string{
		"export effect function main() { return try sync(() => 1) }",
		"export effect function main() { return try Effect.try(() => JSON.parse(\"1\") as number) }",
		"export effect function main() { const f = try sync(() => effect () => try Effect.succeed(1)); return try f() }",
		"export effect function main() { return try sync(() => { try { return 1 } catch { return 2 } }) }",
	} {
		if errs := tryInHatchErrors(t, w, source); len(errs) != 0 {
			t.Errorf("valid program rejected with %v: %q", errs, source)
		}
	}
}

const tryInWrapperCallbackTarget = "FuzzTryInWrapperCallback"

// Each table holds one axis of the neighbourhood; %s is the next axis.
var (
	// The wrappers whose callback the compiler once read as TypeScript.
	tryInWrapperCallbackWrappers = []struct{ name, form string }{
		{"sync", "sync(%s)"},
		{"effect-try", "Effect.try(%s)"},
		{"effect-try-parenthesized", "Effect.try((%s))"},
		{"effect-try-options", "Effect.try({ try: %s, catch: (cause) => new Bad({ cause }) })"},
		{"effect-try-promise", "Effect.tryPromise(%s)"},
		{"effect-try-promise-options", "Effect.tryPromise({ try: %s, catch: (cause) => new Bad({ cause }) })"},
		{"try-promise", "tryPromise(%s)"},
		{"try-promise-options", "tryPromise({ try: %s, catch: (cause) => new Bad({ cause }) })"},
	}
	tryInWrapperCallbackShapes = []struct{ name, form string }{
		{"arrow", "() => %s"},
		{"arrow-block", "() => { const v = %s; return v }"},
		{"function", "function () { return %s }"},
		{"nested-arrow", "() => [0].map(() => %s)"},
		{"nested-function", "() => { function inner() { return %s }; return inner() }"},
	}
	// The execution forms EK0501 names (chapter 2), and the callback without one.
	tryInWrapperCallbackForms = []struct {
		name, form string
		tries      int
	}{
		{"try", "try Effect.succeed(1)", 1},
		{"try-parenthesized", "try (Effect.succeed(1))", 1},
		{"try-call", "try work()", 1},
		{"try-all", "try.all [Effect.succeed(1)]", 1},
		{"try-race", "try.race [Effect.succeed(1)]", 1},
		{"try-any", "try.any [Effect.succeed(1)]", 1},
		{"try-all-settled", "try.allSettled [Effect.succeed(1)]", 1},
		{"none", "Effect.succeed(1)", 0},
	}
	// The code around the wrapper call: effect code or not, the callback is plain.
	tryInWrapperCallbackHomes = []struct{ name, form string }{
		{"effect-function", "export effect function main() { const r = try %s; return r }"},
		{"effect-arrow", "export const main = effect () => { const r = try %s; return r }"},
		{"effect-block", "export function main() { return effect { const r = try %s; return r } }"},
		{"plain-function", "export function main() { return %s }"},
		{"module", "export const main = %s"},
	}
)

func tryInWrapperCallbackNames() []string {
	var names []string
	for _, w := range tryInWrapperCallbackWrappers {
		for _, s := range tryInWrapperCallbackShapes {
			for _, f := range tryInWrapperCallbackForms {
				for _, h := range tryInWrapperCallbackHomes {
					names = append(names, w.name+"/"+s.name+"/"+f.name+"/"+h.name)
				}
			}
		}
	}
	return names
}

func tryInWrapperCallbackSource(name string) (string, int) {
	parts := strings.Split(name, "/")
	wrapper := tryInWrapperCallbackWrappers[slices.IndexFunc(tryInWrapperCallbackWrappers, func(x struct{ name, form string }) bool { return x.name == parts[0] })]
	shape := tryInWrapperCallbackShapes[slices.IndexFunc(tryInWrapperCallbackShapes, func(x struct{ name, form string }) bool { return x.name == parts[1] })]
	form := tryInWrapperCallbackForms[slices.IndexFunc(tryInWrapperCallbackForms, func(x struct {
		name, form string
		tries      int
	}) bool {
		return x.name == parts[2]
	})]
	home := tryInWrapperCallbackHomes[slices.IndexFunc(tryInWrapperCallbackHomes, func(x struct{ name, form string }) bool { return x.name == parts[3] })]
	call := fmt.Sprintf(wrapper.form, fmt.Sprintf(shape.form, form.form))
	return "error Bad { cause: unknown }\nexport effect function work() { return 1 }\n" + fmt.Sprintf(home.form, call) + "\n", form.tries
}

// checkTryInWrapperCallback compiles one program of the neighbourhood. The
// callback of sync, Effect.try or tryPromise is an ordinary plain function, so
// its try is outside effect code whatever stands around the wrapper call:
// exactly one EK0501, and none when the callback holds no try. Other errors,
// such as a callback type the wrapper's signature rejects, are not this rule's.
func checkTryInWrapperCallback(t *testing.T, w *Workspace, name string) {
	t.Helper()
	source, tries := tryInWrapperCallbackSource(name)
	r, err := w.Compile(t.Context(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	_, errs := advisoryCodes(r.Diagnostics)
	got := 0
	for _, code := range errs {
		if code == "EK0501" {
			got++
		}
	}
	parts := strings.Split(name, "/")
	switch {
	case got < tries:
		Gap(t, tryInWrapperCallbackTarget, "missing:EK0501/"+parts[0]+"/"+parts[2], "002-running: %s; %s: the try stands in a plain callback, but the compiler gives %v:\n%s", grammarTryInHatchRuleQuote, name, errs, source)
	case got > tries:
		Gap(t, tryInWrapperCallbackTarget, "extra:EK0501/"+parts[0]+"/"+parts[2], "002-running: %s; %s: want %d EK0501, but the compiler gives %v:\n%s", grammarTryInHatchRuleQuote, name, tries, errs, source)
	}
}

func TestTryInWrapperCallback(t *testing.T) {
	tryInWrapperCallbackQuoted(t)
	w := NewWorkspace(t)
	for _, name := range tryInWrapperCallbackNames() {
		// Every wrapper with every form in effect code, and every shape and
		// home with the plain try: the fuzz target reaches the rest.
		parts := strings.Split(name, "/")
		if parts[1] == "arrow" && parts[3] == "effect-function" || parts[2] == "try" {
			t.Run(name, func(t *testing.T) { checkTryInWrapperCallback(t, w, name) })
		}
	}
}

func FuzzTryInWrapperCallback(f *testing.F) {
	startShortBudget(f)
	tryInWrapperCallbackQuoted(f)
	names := tryInWrapperCallbackNames()
	for _, name := range names {
		parts := strings.Split(name, "/")
		if parts[1] == "arrow" && parts[3] == "effect-function" {
			f.Add([]byte("key:" + name))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		checkTryInWrapperCallback(t, w, names[advisoryPick(data, names)])
	})
}
