package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const reviewComputedTarget = "FuzzReviewComputedKeys"
const reviewComputedQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
const reviewComputedErrorQuote = "Field keys follow their actual counterpart's native checks."
const reviewComputedDataQuote = "Exported `schema` and `data` declarations emit the TypeScript declarations of their Effect TypeScript counterparts above"

func TestReviewComputedKeysQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"000-intro.md":    reviewComputedQuote,
		"003-failures.md": reviewComputedErrorQuote,
		"006-data.md":     reviewComputedDataQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func reviewComputedPair(kind, typ, expression string) (string, string) {
	setup := map[string]string{
		"number":  "const keys: { value: number } = { value: 42 }; function key(): number { return keys.value }",
		"literal": "const keys: { value: 42 } = { value: 42 }; function key(): 42 { return keys.value }",
		"symbol":  "const token = Symbol(\"key\"); const keys: { value: typeof token } = { value: token }; function key(): typeof token { return keys.value }",
	}[typ]
	key := map[string]string{"entity": "keys.value", "parenthesized": "(keys.value)", "element": "keys[\"value\"]", "call": "key()"}[expression]
	head := "import { Data, Schema } from \"effect\";\n" + setup + "\n"
	switch kind {
	case "schema":
		return head + "schema Shape { [" + key + "]: number }\n", head + "const Shape = Schema.Struct({ [" + key + "]: Schema.mutableKey(Schema.Number) });\n"
	case "schema-error":
		return head + "schema error Shape { [" + key + "]: number }\n", head + "class Shape extends Schema.TaggedError<Shape>()(\"Shape\", { [" + key + "]: Schema.Number }) {}\n"
	case "error":
		return head + "error Shape { [" + key + "]: number }\n", head + "class Shape extends Data.TaggedError(\"Shape\")<{ [" + key + "]: number }> {}\n"
	default:
		return head + "data Shape { Row { [" + key + "]: number } }\n", head + "type Shape = Data.TaggedEnum<{ Row: { [" + key + "]: number } }>; const Shape = Data.taggedEnum<Shape>();\n"
	}
}

// ASTRA-4 / detail233: runtime object keys and erased payload keys follow
// their actual Effect TypeScript counterparts. This compares the compiler
// with itself on the two inputs the specification says must agree.
func FuzzReviewComputedKeys(f *testing.F) {
	startShortBudget(f)
	kinds := []string{"schema", "schema-error", "error", "data"}
	types := []string{"number", "literal", "symbol"}
	expressions := []string{"entity", "parenthesized", "element", "call"}
	var keys []string
	for _, kind := range kinds {
		for _, typ := range types {
			for _, expression := range expressions {
				key := kind + ":" + typ + ":" + expression
				keys = append(keys, key)
				f.Add(key)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewComputedKeysQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		parts := strings.Split(key, ":")
		source, reference := reviewComputedPair(parts[0], parts[1], parts[2])
		compile := func(name, text string) *Result {
			t.Helper()
			var result *Result
			var err error
			within(t, "check computed key "+name, func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: text}}) })
			if err != nil {
				t.Fatal(err)
			}
			return result
		}
		before := compile("main.ts", reference)
		defer before.Remove()
		after := compile("main.vibe", source)
		defer after.Remove()
		codes := func(result *Result) []string {
			var errors []string
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Category().Name() == "error" {
					errors = append(errors, diagnosticKey(diagnostic))
				}
			}
			slices.Sort(errors)
			return errors
		}
		expected, actual := codes(before), codes(after)
		if !slices.Equal(expected, actual) {
			Gap(t, reviewComputedTarget, "feature:"+key, "Chapter0: %q; fields use their Effect TypeScript counterpart. Reference errors %v, Vibe errors %v\nreference:\n%s\nsource:\n%s", reviewComputedQuote, expected, actual, reference, source)
		}
		ExpectPending(t, reviewComputedTarget, "feature:"+key)
		ExpectPending(t, reviewComputedTarget, specCorpusKey(t))
	})
}
