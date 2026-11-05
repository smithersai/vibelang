package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Chapter 4, Class patterns: the registration emitted by the schema-error
// repair installs precisely such an own property. This is an admission oracle,
// not a second runtime differential interpreter.
const schemaRegisteredMatcherQuote = "An inherited matcher does not count."

func TestSchemaRegisteredMatcherQuoted(t *testing.T) {
	const erasureQuote = "Plain functions, `async` functions, `await`, `throw`, `using`, classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning."
	if !strings.Contains(SpecText("000-intro.md"), erasureQuote) {
		t.Fatalf("missing TypeScript meaning rule %q", erasureQuote)
	}
	if !strings.Contains(SpecText("004-match.md"), schemaRegisteredMatcherQuote) {
		t.Fatalf("missing own-matcher rule %q", schemaRegisteredMatcherQuote)
	}
}

func FuzzSchemaRegisteredMatcher(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"own", "namespace", "inherited", "conditional", "wrong-receiver", "shadowed", "assertion", "assertion-private", "assertion-protected", "parenthesized", "nonnull", "satisfies", "asserted-inherited", "asserted-conditional", "asserted-wrong-receiver", "asserted-shadowed"} {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestSchemaRegisteredMatcherQuoted(t)
		name := []string{"E", "GoneΩ", "Failure"}[mode%3]
		imported := "import { $schemaErrorMatcher as install } from 'vibelang-runtime';\n"
		call := "install(this, " + fmt.Sprintf("%q", name) + ")"
		pattern := name
		rejected := true
		switch key {
		case "own":
			rejected = false
		case "namespace":
			imported = "import * as runtime from 'vibelang-runtime';\n"
			call = "runtime.$schemaErrorMatcher(this, " + fmt.Sprintf("%q", name) + ")"
			rejected = false
		case "assertion", "assertion-private", "assertion-protected":
			call = "install(this as unknown as abstract new (...args: any[]) => unknown, " + fmt.Sprintf("%q", name) + ")"
			rejected = false
		case "parenthesized":
			call = "install(((this)), " + fmt.Sprintf("%q", name) + ")"
			rejected = false
		case "nonnull":
			call = "install(this!, " + fmt.Sprintf("%q", name) + ")"
			rejected = false
		case "satisfies":
			call = "install(this satisfies unknown, " + fmt.Sprintf("%q", name) + ")"
			rejected = false
		case "asserted-inherited":
			pattern = "Sub"
			call = "install(this as unknown as abstract new (...args: any[]) => unknown, " + fmt.Sprintf("%q", name) + ")"
		case "asserted-conditional":
			call = "if (false) install(this as unknown as abstract new (...args: any[]) => unknown, " + fmt.Sprintf("%q", name) + ")"
		case "asserted-wrong-receiver":
			call = "install(Other as unknown as abstract new (...args: any[]) => unknown, " + fmt.Sprintf("%q", name) + ")"
		case "asserted-shadowed":
			imported = "function install(..._args: unknown[]): void {}\n"
			call = "install(this as unknown as abstract new (...args: any[]) => unknown, " + fmt.Sprintf("%q", name) + ")"
		case "inherited":
			pattern = "Sub"
		case "conditional":
			call = "if (false) " + call
		case "wrong-receiver":
			call = "install(Other, " + fmt.Sprintf("%q", name) + ")"
		case "shadowed":
			imported = "function install(..._args: unknown[]): void {}\n"
		default:
			key = "own"
			rejected = false
		}
		constructor := ""
		if key == "assertion-private" {
			constructor = "private constructor(){} "
		}
		if key == "assertion-protected" {
			constructor = "protected constructor(){} "
		}
		source := imported + "class Other {}\nclass " + name + " { " + constructor + "static { " + call + " } }\n"
		if key == "inherited" || key == "asserted-inherited" {
			source += "class Sub extends " + name + " {}\n"
		}
		source += "export function probe(subject: unknown) { return match(subject) { when " + pattern + "(let item): item; default: undefined; } }\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := false
		for _, d := range r.Diagnostics {
			if d.Code() == 704 {
				found = true
			}
		}
		if found != rejected {
			Gap(t, "FuzzSchemaRegisteredMatcher", key, "Chapter 4: %s; EK0704=%v, want %v\n%s", schemaRegisteredMatcherQuote, found, rejected, source)
		}
	})
}
