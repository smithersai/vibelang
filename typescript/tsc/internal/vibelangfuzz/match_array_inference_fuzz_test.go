package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const matchArrayInferenceTarget = "FuzzMatchArrayBindingInference"
const matchArrayInferenceQuote = "A `let` binding has the type TypeScript gives the value it is bound to in the counterpart."

func TestMatchArrayBindingInferenceQuoted(t *testing.T) {
	chapter := SpecText("004-match.md")
	for _, quote := range []string{matchArrayInferenceQuote, matchBindingElementQuote, "A payload that includes `undefined` keeps that type after the presence test."} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 4 no longer says %q", quote)
		}
	}
}

// Compare inferred declarations: an explicit return annotation accepts any and
// would hide lost element types. IteratorResult.done proves presence without
// removing an undefined that belongs to the payload, under either index option.
func FuzzMatchArrayBindingInference(f *testing.F) {
	startShortBudget(f)
	keys := []string{"mutable", "readonly", "readonly-alias", "nullable", "nested", "object", "tuple"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	for _, variant := range []uint8{4, 8, 16, 31} {
		f.Add("readonly", variant)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestMatchArrayBindingInferenceQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		typ := []string{"A", "number | undefined", "{ readonly n: number }", "readonly string[]"}[variant%4]
		subject, path, pattern, prelude := "("+typ+")[]", "s", "[BIND v]", ""
		switch key {
		case "readonly":
			subject = "readonly " + subject
		case "readonly-alias":
			subject = "ReadonlyArray<" + typ + ">"
		case "nullable":
			subject = "readonly " + subject + " | null"
			prelude = "if (s === null) return fallback;"
		case "nested":
			subject = "readonly (readonly " + subject + ")[]"
			pattern = "[[BIND v]]"
		case "object":
			subject = "{ xs: readonly " + subject + " }"
			path = "s.xs"
			pattern = "{ xs: [BIND v] }"
		case "tuple":
			subject = "readonly [" + typ + "]"
		}
		binding := "let"
		if variant&4 != 0 {
			binding = "const"
		}
		pattern = strings.ReplaceAll(pattern, "BIND", binding)
		head := fmt.Sprintf("export function f<A>(s: %s, fallback: %s) {", subject, typ)
		vibe := head + "return match(s) { when " + pattern + ": v; default: fallback; }}"
		if variant&8 != 0 {
			vibe = head + "if(s is " + pattern + ") return v; return fallback; }"
		}
		native := head + prelude + "const first = " + path + "[Symbol.iterator]().next(); if (first.done) return fallback;"
		if key == "nested" {
			native += "const inner = first.value[Symbol.iterator]().next(); return inner.done ? fallback : inner.value; }"
		} else {
			native += "return first.value; }"
		}
		config := DefaultConfig
		if variant&16 != 0 {
			config = strings.Replace(config, "\"strict\": true,", "\"strict\": true, \"noUncheckedIndexedAccess\": true,", 1)
		}
		compile := func(file, source string) *Result {
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			if !toolsErrorFree(r) {
				t.Fatalf("%s must compile: %v\n%s", file, SortedKeys(Keys(r.Dir, r.Diagnostics)), source)
			}
			return r
		}
		before := compile("main.ts", native)
		after := compile("main.vibe", vibe)
		if diff := compareDeclarationResults(t, before, after); diff != "" {
			Gap(t, matchArrayInferenceTarget, fmt.Sprintf("%s:%d", key, variant%32), "VIP-7: %s\n%s\n%s", matchArrayInferenceQuote, vibe, diff)
		}
		ExpectPending(t, matchArrayInferenceTarget, specCorpusKey(t))
	})
}
