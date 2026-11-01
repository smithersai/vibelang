package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const reviewIsBindingHomesTarget = "FuzzReviewIsBindingHomes"

// Chapter 4, "Every other home" (r1 ASTRA-5, decided details 214 and 240).
const reviewIsArrowHomeQuote = "In a concise arrow body, a binding belongs to the arrow body's scope, where the block-body form would declare it."
const reviewIsFieldHomeQuote = "In a class field or static field initializer, a binding belongs to that initializer's own scope, because ECMAScript evaluates each initializer as a separate method-like body. A `static` block is a block."
const reviewIsEnumHomeQuote = "An `enum` member initializer has no lexical home in ECMAScript or the pinned explainer, so a binding introduced there is `EK0705`, as for a formal parameter"
const reviewIsForInitHomeQuote = "In `for (init; test; update)`, a binding from `init` belongs to the loop head, as a name declared by a `let` or `const` declaration in `init` would, whether `init` is a declaration or an expression"
const reviewIsForHeadHomeQuote = "a binding from the head expression, which runs once in the head's own environment, is copied into each iteration's binding environment; a skipped binding is copied uninitialized. A binding from a default inside the head declaration belongs to that iteration's fresh binding environment."
const reviewIsParameterHomeQuote = "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home. This includes direct defaults, defaults nested in parameter destructuring, and evaluated computed binding keys."
const reviewIsParameterBlockQuote = "A binding in an explicit source block within the initializer, including a `do` block or a match arm's scope, belongs to that block/arm and does not escape to other parameters or the body. Nested source callable bodies keep their own scopes and boundaries."

func TestReviewIsBindingHomesQuoted(t *testing.T) {
	chapter := SpecText("004-match.md")
	for _, quote := range []string{reviewIsArrowHomeQuote, reviewIsFieldHomeQuote, reviewIsEnumHomeQuote, reviewIsForInitHomeQuote, reviewIsForHeadHomeQuote, reviewIsParameterHomeQuote, reviewIsParameterBlockQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 4 no longer says %q; re-read the binding-home table before changing this oracle", quote)
		}
	}
}

type reviewIsBindingHome struct {
	name   string
	reject bool // the home is EK0705: no lexical home exists for the binding
}

func reviewIsBindingHomes() []reviewIsBindingHome {
	return []reviewIsBindingHome{
		{"concise-arrow", false},
		{"class-field", false},
		{"static-field", false},
		{"static-block", false},
		{"for-init-expression", false},
		{"for-test", false},
		{"for-of-head", false},
		{"for-of-default", false},
		{"parameter-do-block", false},
		{"parameter-match-arm", false},
		{"parameter-nested-arrow", false},
		{"enum-initializer", true},
		{"parameter-default", true},
		{"parameter-nested-default", true},
		{"parameter-computed-key", true},
	}
}

// reviewIsBindingHomeProgram writes the home with an `is` binding `cell`
// (a plain `let cell` at the same home for the native control) and, with
// leak, a read of `cell` just outside the home that the spec says must fail.
func reviewIsBindingHomeProgram(home string, leak, native bool) string {
	bind := "(a is let cell) && cell"
	if native {
		bind = "(() => { let cell = a; return cell })()"
	}
	var body string
	switch home {
	case "concise-arrow":
		body = "export const probe = (a: unknown) => " + bind + ";\n"
		if native {
			body = "export const probe = (a: unknown) => { let cell = a; return cell };\n"
		}
		if leak {
			body += "void cell;\n"
		}
	case "class-field", "static-field", "static-block":
		member := "field = " + bind + ";"
		switch home {
		case "static-field":
			member = "static field = " + bind + ";"
		case "static-block":
			member = "static { (a is let cell) && cell; }"
			if native {
				member = "static { let cell = a; void cell; }"
			}
		}
		other := ""
		if leak {
			other = " static other = cell;"
		}
		body = "export class Probe { " + member + other + " }\n"
	case "for-init-expression":
		head := "for (" + bind + "; false; )"
		if native {
			head = "for (let cell = a; false; )"
		}
		body = "export function probe(): void {\n" + head + " { void cell; }\n"
		if leak {
			body += "void cell;\n"
		}
		body += "}\n"
	case "for-test":
		head := "for (; (a is let cell) && cell; )"
		loop := head + " { void cell; break; }"
		if native {
			loop = "for (;;) { let cell = a; void cell; break; }"
		}
		body = "export function probe(): void {\n" + loop + "\n"
		if leak {
			body += "void cell;\n"
		}
		body += "}\n"
	case "for-of-head":
		head := "for (const item of ((a is let cell) && [cell]) || [])"
		loop := head + " { void item; void cell; }"
		if native {
			loop = "for (const item of [a]) { let cell = item; void cell; }"
		}
		body = "export function probe(): void {\n" + loop + "\n"
		if leak {
			body += "void cell;\n"
		}
		body += "}\n"
	case "for-of-default":
		loop := "for (const { x = (a is let cell) && cell } of [{}] as { x?: unknown }[]) { void x; void cell; }"
		if native {
			loop = "for (const { x = a } of [{}] as { x?: unknown }[]) { let cell = x; void cell; }"
		}
		body = "export function probe(): void {\n" + loop + "\n"
		if leak {
			body += "void cell;\n"
		}
		body += "}\n"
	case "parameter-do-block", "parameter-match-arm", "parameter-nested-arrow":
		initializer := "do { const ok = (1 is let cell); [ok, cell] }"
		switch home {
		case "parameter-match-arm":
			initializer = "match (1) { when let x: (x is let cell) ? cell : 0; }"
		case "parameter-nested-arrow":
			initializer = "() => (1 is let cell)"
		}
		if native {
			initializer = "(() => { let cell = 1; return cell })()"
			if home == "parameter-nested-arrow" {
				initializer = "() => { let cell = 1; return cell }"
			}
		}
		ret := "return p"
		if leak {
			ret = "return cell"
		}
		body = "export function probe(p = " + initializer + ") { " + ret + " }\n"
	case "enum-initializer":
		body = "export enum E { A = (1 is let one) ? 1 : 0 }\n"
	case "parameter-default":
		body = "export function probe(p = (1 is let captured)) { return p }\n"
	case "parameter-nested-default":
		body = "export function probe({ p = (1 is const captured) } = {}) { return p }\n"
	case "parameter-computed-key":
		body = "export function probe({ [(1 is let captured) ? \"x\" : \"y\"]: value }: { x?: number; y?: number } = {}) { return value }\n"
	default:
		panic("unknown binding home")
	}
	return "declare const a: unknown;\n" + body
}

// r1 ASTRA-5: the binding-home table of Chapter 4. A positive home admits the
// binding and keeps it invisible just outside; an `EK0705` home rejects the
// binding. These are admission and name-visibility checks only; per-iteration
// cell identity stays with the VIP-7 differential constructs.
func FuzzReviewIsBindingHomes(f *testing.F) {
	startShortBudget(f)
	homes := reviewIsBindingHomes()
	for _, home := range homes {
		f.Add(home.name, uint8(0))
		if !home.reject {
			f.Add(home.name, uint8(1))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, flags uint8) {
		TestReviewIsBindingHomesQuoted(t)
		index := slices.IndexFunc(homes, func(h reviewIsBindingHome) bool { return h.name == name })
		if index < 0 {
			if name == "" {
				return
			}
			index = int(name[0]) % len(homes)
		}
		home := homes[index]
		leak := flags&1 != 0 && !home.reject
		key := fmt.Sprintf("%s:%d", home.name, flags&1)
		for _, native := range []bool{true, false} {
			if native && home.reject {
				continue
			}
			source := reviewIsBindingHomeProgram(home.name, leak, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check is binding home", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			missing, rejected, unexpected := false, false, false
			for _, diagnostic := range result.Diagnostics {
				if !IsEK(diagnostic) && diagnostic.Code() == 2304 && diagnostic.Pos() == strings.LastIndex(source, "cell") {
					missing = true
				} else if diagnostic.Category().Name() == "error" {
					unexpected = true
				}
				if IsEK(diagnostic) && diagnostic.Code() == 705 {
					rejected = true
				}
			}
			var matches bool
			switch {
			case home.reject:
				matches = rejected
			case leak:
				matches = missing && !unexpected
			default:
				matches = !HasError(result.Diagnostics)
			}
			if !matches {
				if native {
					t.Fatalf("invalid native lexical-home control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				Gap(t, reviewIsBindingHomesTarget, key, "Chapter 4 binding-home table: reject=%t leak=%t, got %v\n%s", home.reject, leak, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, reviewIsBindingHomesTarget, key)
		ExpectPending(t, reviewIsBindingHomesTarget, specCorpusKey(t))
	})
}
