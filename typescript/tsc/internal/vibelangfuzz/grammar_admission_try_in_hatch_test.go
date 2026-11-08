package vibelangfuzz

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// VIP-6 replaces the legacy hatches, so `sync` is no special prelude form and
// its callback is plain code, where Chapter 2 makes `try` EK0501. The
// compiler still reads the first argument of a call to the prelude's `sync`
// as TypeScript (vibelang/hatches.go: inHatch), skips EK0501 there and emits
// the callback without the `try`.
const (
	grammarTryInHatchVIPQuote  = "D148's hatches (`sync`, `try`, `callback` as special prelude forms) and D229's no-capture rule."
	grammarTryInHatchRuleQuote = "| `try` outside effect code; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | `EK0501` |"
)

func TestGrammarAdmissionTryInHatchQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0006-effect-globals.md"), grammarTryInHatchVIPQuote) {
		t.Fatal("VIP-6 no longer replaces the sync hatch; review admission:try-in-hatch")
	}
	if !strings.Contains(SpecText("002-running.md"), grammarTryInHatchRuleQuote) {
		t.Fatal("Chapter 2's EK0501 row changed; review admission:try-in-hatch")
	}
}

// grammarTryInHatch reports a try in the first argument of a call to the
// prelude's sync. Inputs after the first argument are VibeLang and keep
// EK0501, as do member calls, constructions and a program that declares
// sync, which shadows the prelude name.
func grammarTryInHatch(ts []grammarToken) bool {
	if grammarDeclaresSync(ts) {
		return false
	}
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "sync" || i+1 >= len(ts) || ts[i+1].text != "(" {
			continue
		}
		if i > 0 {
			switch ts[i-1].text {
			case ".", "?.", "new", "function", "#":
				continue
			}
		}
		depth := 0
	argument:
		for j := i + 2; j < len(ts); j++ {
			switch ts[j].text {
			case "(", "[", "{":
				depth++
				continue
			case ")", "]", "}":
				if depth == 0 {
					break argument
				}
				depth--
				continue
			case ",":
				if depth == 0 {
					break argument
				}
			}
			if ts[j].kind == 'w' && ts[j].text == "try" && j+1 < len(ts) &&
				ts[j+1].text != "{" && ts[j+1].text != ":" && ts[j-1].text != "." && ts[j-1].text != "?." {
				return true
			}
		}
	}
	return false
}

// grammarDeclaresSync reports a function, class, variable, import or
// parameter named sync anywhere in the program.
func grammarDeclaresSync(ts []grammarToken) bool {
	importing := false
	for i, tok := range ts {
		switch {
		case tok.kind == 'w' && tok.text == "import":
			importing = true
		case tok.text == ";" || tok.kind == 's' || tok.kind == 'w' && tok.text == "from":
			importing = false
		}
		if tok.kind != 'w' || tok.text != "sync" || i == 0 {
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

var grammarTryInHatchGaps = []string{
	grammarTryInHatchWitness,
	grammarTryInHatchCaseWitness,
	"export effect function main() { return sync(() => try 1) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => { const v = try Effect.succeed(1); return v }) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => try.all [Effect.succeed(1)]) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(function () { return try Effect.succeed(1) }) }",
	"import { Effect } from \"effect\"\nexport effect function main() { return try sync(() => [1].map(() => try Effect.succeed(1))) }",
}

func TestGrammarAdmissionTryInHatchKeys(t *testing.T) {
	for _, source := range append(slices.Clone(grammarTryInHatchGaps),
		"module helpers {\nexport function pick ( flag : boolean ) : number | Promise < number > {\nreturn flag ? Promise . resolve ( 6 ) : 7\n}\n}\nimport { pick } from helpers\nexport effect function main ( ) {\nconst resolved : number = try sync ( ( flag : boolean ) : number | Promise < number > => try flag ? Promise . resolve ( 1 ) : 2 , true )\nreturn [ resolved ]\n}",
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
	} {
		if got := grammarAdmissionForm(source); got == "admission:try-in-hatch" {
			t.Errorf("control keyed as a try in a sync hatch: %q", source)
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
	// The emitted hatch callback returns the Effect it should have run.
	r, err := w.Compile(context.Background(), Single(grammarTryInHatchWitness))
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Diagnostics) != 0 || !strings.Contains(r.Outputs["out/main.js"], ".sync(() => Effect.succeed(1))") {
		t.Errorf("witness diagnostics or emit changed: %v\n%s", r.Diagnostics, r.Outputs["out/main.js"])
	}
	for _, source := range []string{
		"export effect function main() { return try sync(() => 1) }",
		"export effect function main() { const f = () => try 1; return f }",
		"export effect function main() { return sync((n: number) => n, () => try 1) }",
		"function sync(f: () => number) { return f() }\nexport effect function main() { return sync(() => try 1) }",
		"import { Effect } from \"effect\"\nexport effect function main() { return x.sync(() => try Effect.succeed(1)) }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}
