package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const collectionExtractorTarget = "FuzzMatchCollectionExtractorTypes"

var collectionExtractorQuotes = []string{
	"A `let` binding has the type TypeScript gives the value it is bound to in the counterpart.",
	"| other built-in constructor extractor | its specified recognition test | elements of its actual draft extraction list; `Map` and `Set` return `[s]`, so bind the collection |",
}

func TestMatchCollectionExtractorTypesQuoted(t *testing.T) {
	chapter := SpecText("004-match.md")
	for _, quote := range collectionExtractorQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 4 no longer says %q", quote)
		}
	}
}

// These are static binding-type checks, derived from VIP-7's extraction list
// and TypeScript counterpart. Mutations vary collection, payload, aliases,
// subclasses, union subjects, binding kind, and match/is/nested pattern homes.
func FuzzMatchCollectionExtractorTypes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"map", "set", "map-alias", "set-alias", "map-subclass", "set-subclass", "map-union", "set-union", "map-generic", "set-generic"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(5))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestMatchCollectionExtractorTypesQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		payload := []string{"string", "{ readonly id: string }", "boolean | undefined"}[int(variant)%3]
		generic, prelude := "", ""
		if strings.HasSuffix(key, "-generic") {
			generic, payload = "<A>", "A"
		}
		collection, wrong := "Map<string, "+payload+">", "value.get(123)"
		matcher := "Map"
		if strings.HasPrefix(key, "set") {
			collection, matcher, wrong = "Set<"+payload+">", "Set", "value.has(123)"
		}
		if strings.HasSuffix(key, "-generic") && matcher == "Set" {
			generic = "<A extends { readonly id: string }>"
		}
		expected := collection
		if strings.HasSuffix(key, "-alias") {
			prelude, matcher = "const Alias = "+matcher+";\n", "Alias"
		}
		if strings.HasSuffix(key, "-subclass") {
			prelude = "class Named extends " + collection + " { readonly name = \"named\"; }\n"
			collection, expected = "Named", "Named"
		}
		if strings.HasSuffix(key, "-union") {
			collection += " | null"
		}
		binding := "let"
		if variant&4 != 0 {
			binding = "const"
		}
		pattern := matcher + "(" + binding + " value)"
		use := fmt.Sprintf("const checked: %s = value;\n// @ts-expect-error: the extracted collection retains its key/element type\n%s;\nreturn checked;", expected, wrong)
		body := "if (input is " + pattern + ") { " + use + " } return fallback;"
		if variant&2 != 0 {
			body = "return match (input) { when " + pattern + ": do { " + strings.Replace(use, "return checked;", "checked;", 1) + " }; default: fallback; };"
		}
		if variant&8 != 0 {
			collection = "{ inner: " + collection + " }"
			body = "return match (input) { when { inner: " + pattern + " }: do { " + strings.Replace(use, "return checked;", "checked;", 1) + " }; default: fallback; };"
		}
		source := fmt.Sprintf("%s export function read%s(input: %s, fallback: %s): %s { %s }", prelude, generic, collection, expected, expected, body)
		config := strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true, \"noUncheckedIndexedAccess\": true,", 1)
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source}})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		gapKey := fmt.Sprintf("binding:%s:%d", key, variant%16)
		if HasError(result.Diagnostics) {
			Gap(t, collectionExtractorTarget, gapKey, "VIP-7: %s; got %v\n%s", collectionExtractorQuotes[1], Keys(result.Dir, result.Diagnostics), source)
		}
		ExpectPending(t, collectionExtractorTarget, gapKey)
		ExpectPending(t, collectionExtractorTarget, specCorpusKey(t))
	})
}
