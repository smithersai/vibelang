package vibelangfuzz

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// VIP-6 replaces the legacy hatches, so `sync` is no special prelude form and
// its callback is plain code, where Chapter 2 makes `try` EK0501. The arrows
// that Effect's own wrappers take are plain code too: VIP-6 says no language
// feature wraps TypeScript into an Effect. The compiler still reads the first
// argument of a call to the prelude's `sync`, and the function that
// `Effect.try`, `Effect.tryPromise` or the global `tryPromise` wraps, as
// TypeScript (vibelang/hatches.go: inHatch, isWrappedCode), skips EK0501 there
// and emits the callback without the `try`.
const (
	grammarTryInHatchVIPQuote     = "D148's hatches (`sync`, `try`, `callback` as special prelude forms) and D229's no-capture rule."
	grammarTryInHatchWrapperQuote = "No language feature wraps TypeScript into an Effect. You use Effect's own functions (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TS."
	grammarTryInHatchRuleQuote    = "| `try` outside effect code; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | `EK0501` |"
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
}

// grammarTryInHatch reports a try in the code the compiler reads as a hatch's
// TypeScript: the first argument of a call to the prelude's sync or the global
// tryPromise, or the function that Effect.try or Effect.tryPromise wraps, as
// the call's first argument or as the try property of its options object.
// Inputs after the first argument are VibeLang and keep EK0501, as do member
// calls on anything but Effect, constructions and a program that declares the
// global name, which shadows it.
func grammarTryInHatch(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || i+1 >= len(ts) || ts[i+1].text != "(" || !grammarHatchCallee(ts, i) {
			continue
		}
		if grammarTryInHatchArgument(ts, i+2) {
			return true
		}
	}
	return false
}

// grammarHatchCallee reports whether the word at i, before "(", names a
// hatch: Effect.try or Effect.tryPromise, which the compiler recognizes by
// the name Effect; or the undeclared global sync or tryPromise, not a member,
// a construction or a declaration.
func grammarHatchCallee(ts []grammarToken, i int) bool {
	switch ts[i].text {
	case "try", "tryPromise":
		if i >= 2 && ts[i-1].text == "." && ts[i-2].kind == 'w' && ts[i-2].text == "Effect" {
			if i >= 3 {
				switch ts[i-3].text {
				case ".", "?.", "new":
					return false
				}
			}
			return true
		}
		if ts[i].text == "try" {
			return false
		}
	case "sync":
	default:
		return false
	}
	if grammarDeclaresName(ts, ts[i].text) {
		return false
	}
	if i > 0 {
		switch ts[i-1].text {
		case ".", "?.", "new", "function", "#":
			return false
		}
	}
	return true
}

// grammarTryInHatchArgument reports a try in the first argument that starts
// at start. An options object wraps only its try property's value.
func grammarTryInHatchArgument(ts []grammarToken, start int) bool {
	end := grammarBalancedEnd(ts, start)
	if start < end && ts[start].text == "{" {
		for j := start + 1; j < end; {
			next := grammarBalancedEnd(ts, j)
			if j+1 < next && ts[j].kind == 'w' && ts[j].text == "try" && ts[j+1].text == ":" && grammarTryBetween(ts, j+2, next) {
				return true
			}
			j = next + 1
		}
		return false
	}
	return grammarTryBetween(ts, start, end)
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

// grammarTryBetween reports a try operator in ts[start:end]: the word try
// that is not a try statement, a property name or a member name.
func grammarTryBetween(ts []grammarToken, start, end int) bool {
	for j := max(start, 1); j < end && j+1 < len(ts); j++ {
		if ts[j].kind == 'w' && ts[j].text == "try" &&
			ts[j+1].text != "{" && ts[j+1].text != ":" && ts[j-1].text != "." && ts[j-1].text != "?." {
			return true
		}
	}
	return false
}

// grammarDeclaresName reports a function, class, variable, import or
// parameter named name anywhere in the program.
func grammarDeclaresName(ts []grammarToken, name string) bool {
	importing := false
	for i, tok := range ts {
		switch {
		case tok.kind == 'w' && tok.text == "import":
			importing = true
		case tok.text == ";" || tok.kind == 's' || tok.kind == 'w' && tok.text == "from":
			importing = false
		}
		if tok.kind != 'w' || tok.text != name || i == 0 {
			continue
		}
		if importing {
			return true
		}
		switch ts[i-1].text {
		case "function", "class", "const", "let", "var", "enum", "as":
			return true
		case "(", ",":
			if i+1 < len(ts) && (ts[i+1].text == ":" || ts[i+1].text == "=" || ts[i+1].text == "?") {
				return true
			}
		}
		if i+1 < len(ts) && ts[i+1].text == "=>" {
			return true
		}
	}
	return false
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

var grammarTryInHatchGaps = []string{
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

func TestGrammarAdmissionTryInHatchKeys(t *testing.T) {
	for _, source := range append(slices.Clone(grammarTryInHatchGaps),
		"module helpers {\nexport function pick ( flag : boolean ) : number | Promise < number > {\nreturn flag ? Promise . resolve ( 6 ) : 7\n}\n}\nimport { pick } from helpers\nexport effect function main ( ) {\nconst resolved : number = try sync ( ( flag : boolean ) : number | Promise < number > => try flag ? Promise . resolve ( 1 ) : 2 , true )\nreturn [ resolved ]\n}",
		"export effect function main() { return try Effect.try(function () { return try 1 }) }",
		"export effect function main() { return try Effect.try((() => try 1)) }",
	) {
		if got := grammarAdmissionForm(source); got != "admission:try-in-hatch" {
			t.Errorf("key=%q, want admission:try-in-hatch: %q", got, source)
		}
	}
	for _, source := range []string{
		"export effect function main() { const f = () => try 1; return f }",
		"export effect function main() { return x.sync(() => try 1) }",
		"export effect function main() { return new sync(() => try 1) }",
		"export effect function main() { return sync((n: number) => n, () => try 1) }",
		"function sync(f: () => number) { return f() }\nexport effect function main() { return sync(() => try 1) }",
		"import { sync } from \"./m.js\"\nexport effect function main() { return sync(() => try 1) }",
		"function g(sync: (f: () => number) => number) { return sync(() => try 1) }",
		"export effect function main() { return try sync(() => { try { return 1 } catch { return 2 } }) }",
		"export effect function main() { return try sync(() => ({ try: 1 }).try) }",
		"export effect function main() { return x.try(() => try 1) }",
		"export effect function main() { return new Effect.try(() => try 1) }",
		"export effect function main() { return lib.Effect.try(() => try 1) }",
		"export effect function main() { return Effect.map(Effect.succeed(1), () => try 1) }",
		"export effect function main() { return Effect.try(() => 1, () => try 1) }",
		"export effect function main() { return Effect.try({ try: () => 1, catch: () => try 1 }) }",
		"function tryPromise(f: () => number) { return f() }\nexport effect function main() { return tryPromise(() => try 1) }",
		"export effect function main() { return x.tryPromise(() => try 1) }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:try-in-hatch" {
			t.Errorf("control keyed as a try in a hatch: %q", source)
		}
	}
}

func TestGrammarAdmissionTryInHatchRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarTryInHatchGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// The emitted callbacks return the Effect they should have run.
	for witness, emitted := range map[string]string{
		grammarTryInHatchWitness:        ".sync(() => Effect.succeed(1))",
		grammarTryInHatchWrapperWitness: "Effect.try(() => Effect.succeed(1))",
	} {
		r, err := w.Compile(context.Background(), Single(witness))
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Diagnostics) != 0 || !strings.Contains(r.Outputs["out/main.js"], emitted) {
			t.Errorf("witness diagnostics or emit changed: %v\n%s", r.Diagnostics, r.Outputs["out/main.js"])
		}
	}
	for _, source := range []string{
		"export effect function main() { return try sync(() => 1) }",
		"export effect function main() { const f = () => try 1; return f }",
		"export effect function main() { return sync((n: number) => n, () => try 1) }",
		"function sync(f: () => number) { return f() }\nexport effect function main() { return sync(() => try 1) }",
		"import { Effect } from \"effect\"\nexport effect function main() { return x.sync(() => try Effect.succeed(1)) }",
		"import { Effect } from \"effect\"\nexport effect function main() { return try Effect.try(() => Effect.succeed(1)) }",
		"import { Effect } from \"effect\"\nexport effect function main() { return try Effect.map(Effect.succeed(1), () => try Effect.succeed(1)) }",
		"import { Effect } from \"effect\"\nexport effect function main() { return try x.try(() => try Effect.succeed(1)) }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}
