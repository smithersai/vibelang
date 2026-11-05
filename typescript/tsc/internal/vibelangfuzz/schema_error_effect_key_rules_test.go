package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const schemaErrorEffectKeyQuote = "A computed class key and an `extends` clause are effect code, as `await` is allowed there"
const schemaErrorEffectBoundaryQuote = "not counting nested functions, class field or enum member initializers or `static` blocks"
const schemaErrorEffectChannelsQuote = "An omitted slot is `never`, as Effect's own defaults make it. It is never inferred"
const schemaErrorFieldMappingQuote = "Each field's type is mapped as in a `schema` declaration, optional properties included."

func TestSchemaErrorEffectKeysQuoted(t *testing.T) {
	schemaErrorEffectKeysQuoted(t)
}

func schemaErrorEffectKeysQuoted(t testing.TB) {
	t.Helper()
	for chapter, quotes := range map[string][]string{
		"001-functions.md": {schemaErrorEffectChannelsQuote},
		"002-running.md":   {schemaErrorEffectKeyQuote, schemaErrorEffectBoundaryQuote},
		"003-failures.md":  {schemaErrorFieldMappingQuote},
	} {
		text := SpecText(chapter)
		for _, quote := range quotes {
			if !strings.Contains(text, quote) {
				t.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

type schemaErrorEffectKeyRule struct {
	key, source string
}

func schemaErrorEffectKeyRules() []schemaErrorEffectKeyRule {
	var rules []schemaErrorEffectKeyRule
	for _, form := range []struct{ key, declaration string }{
		{"schema-error", "schema error E"},
		{"schema-control", "schema E"},
	} {
		for _, shape := range []struct{ key, field string }{
			{"struct", "value: { readonly [%s]: string }"},
			{"optional", "value?: { readonly [%s]: string }"},
			{"array", "value: Array<{ readonly [%s]: string }>"},
			{"tuple", "value: [{ readonly [%s]: string }]"},
			{"readonly-array", "value: ReadonlyArray<{ readonly [%s]: string }>"},
			{"parenthesized", "value: ({ readonly [%s]: string })"},
			{"union", "value: { readonly [%s]: string } | undefined"},
		} {
			for _, key := range []struct{ name, expression string }{
				{"string", `try Effect.succeed("key")`},
				{"number", `try Effect.succeed(7)`},
				{"symbol", `try Effect.succeed(field)`},
			} {
				source := "const field: unique symbol = Symbol()\nexport effect function main(): number!! {\n" +
					form.declaration + " { " + fmt.Sprintf(shape.field, key.expression) + " }\nreturn 1\n}\n"
				rules = append(rules, schemaErrorEffectKeyRule{
					form.key + "/" + shape.key + "/" + key.name, source,
				})
			}
		}
	}
	return rules
}

func schemaErrorEffectKeyPick(data []byte, rules []schemaErrorEffectKeyRule) int {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		for i, rule := range rules {
			if rule.key == key {
				return i
			}
		}
	}
	if len(data) == 0 {
		return 0
	}
	return int(data[0]) % len(rules)
}

func TestSchemaErrorEffectKeysStable(t *testing.T) {
	rules := schemaErrorEffectKeyRules()
	keys := map[string]bool{}
	for i, rule := range rules {
		if keys[rule.key] {
			t.Fatalf("duplicate key %s", rule.key)
		}
		keys[rule.key] = true
		if got := schemaErrorEffectKeyPick([]byte("key:"+rule.key), rules); got != i {
			t.Fatalf("%s selects %d, want %d", rule.key, got, i)
		}
		reversed := slices.Clone(rules)
		slices.Reverse(reversed)
		if got := schemaErrorEffectKeyPick([]byte("key:"+rule.key), reversed); reversed[got].key != rule.key {
			t.Fatalf("%s changes meaning when rules reorder", rule.key)
		}
	}
	if len(keys) != 42 {
		t.Fatalf("got %d rules, want 42", len(keys))
	}
}

// Chapter 3 maps nested field codecs just as schema does. The generated
// schema-error fields object belongs to its class's extends expression, which
// Chapter 2 explicitly evaluates in the enclosing Effect code. This is only
// an admission oracle; runtime Exit comparisons belong to FuzzVIPDifferential.
func FuzzSchemaErrorEffectKeys(f *testing.F) {
	startShortBudget(f)
	schemaErrorEffectKeysQuoted(f)
	rules := schemaErrorEffectKeyRules()
	for _, rule := range rules {
		f.Add([]byte("key:" + rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		rule := rules[schemaErrorEffectKeyPick(data, rules)]
		r, err := w.Compile(t.Context(), Single(rule.source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		// A pending admission bug cannot hide a different compiler error.
		independent := slices.DeleteFunc(slices.Clone(errors), func(code string) bool {
			return code == "EK0501" || code == "TS2464"
		})
		if len(independent) != 0 {
			t.Fatalf("%s: independent errors %v\n%s", rule.key, independent, rule.source)
		}
		if len(errors) != 0 {
			Gap(t, "FuzzSchemaErrorEffectKeys", "admission:"+rule.key,
				"002-running: %s; 003-failures: %s; got %v\n%s",
				schemaErrorEffectKeyQuote, schemaErrorFieldMappingQuote, errors, rule.source)
		}
	})
}

// A key runs in the enclosing Effect, so an explicit empty E or R must
// reject its channel. Admitting the key without checking those channels is
// insufficient. The positive controls write both channels explicitly.
func FuzzSchemaErrorEffectKeyChannels(f *testing.F) {
	startShortBudget(f)
	schemaErrorEffectKeysQuoted(f)
	shapes := []struct{ key, field string }{
		{"struct", "value: { readonly [try key]: string }"},
		{"optional", "value?: { readonly [try key]: string }"},
		{"array", "value: Array<{ readonly [try key]: string }>"},
		{"tuple", "value: [{ readonly [try key]: string }]"},
	}
	channels := []struct {
		key, typ, result string
		errors           []string
	}{
		{"failure", "Effect.Effect<string, KeyError>", "number!!", []string{"EK9201"}},
		{"requirement", "Effect.Effect<string, never, Keys>", "number!!", []string{"EK9202"}},
		{"both", "Effect.Effect<string, KeyError, Keys>", "number!!", []string{"EK9201", "EK9202"}},
		{"admitted", "Effect.Effect<string, KeyError, Keys>", "number!KeyError!Keys", nil},
	}
	type rule struct {
		key, source string
		errors      []string
	}
	var rules []rule
	for _, shape := range shapes {
		for _, channel := range channels {
			source := "error KeyError\nservice Keys { static readonly key = \"schema-key/Keys\"; key: string }\ndeclare const key: " + channel.typ +
				"\neffect function test(): " + channel.result + " {\nschema error E { " + shape.field + " }\nreturn 1\n}\n"
			rules = append(rules, rule{shape.key + "/" + channel.key, source, channel.errors})
		}
	}
	for _, rule := range rules {
		f.Add(rule.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		selected := 0
		if len(key) != 0 {
			selected = int(key[0]) % len(rules)
		}
		for i, rule := range rules {
			if rule.key == key {
				selected = i
				break
			}
		}
		rule := rules[selected]
		r, err := w.Compile(t.Context(), Single(rule.source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := r4Errors(r.Diagnostics)
		slices.Sort(got)
		if !slices.Equal(got, rule.errors) {
			t.Fatalf("%s: Chapter 2: %s; Chapter 3: %s; got %v, want %v\n%s",
				rule.key, schemaErrorEffectKeyQuote, schemaErrorFieldMappingQuote, got, rule.errors, rule.source)
		}
	})
}

// Runtime schema codecs inherit their enclosing Effect; a plain function
// and an erased error payload type do not gain permission to run an Effect.
func TestSchemaErrorEffectKeysBoundaries(t *testing.T) {
	schemaErrorEffectKeysQuoted(t)
	w := NewWorkspace(t)
	for name, source := range map[string]string{
		"plain-function":    "effect function outer() { function inner() { schema error E { value: { readonly [try Effect.succeed(\"key\")]: string } } } }",
		"erased-error-type": "effect function outer() { error E { value: { readonly [try Effect.succeed(\"key\")]: string } } }",
	} {
		t.Run(name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if !slices.Contains(r4Errors(r.Diagnostics), "EK0501") {
				t.Fatalf("%s: expected EK0501 outside runtime Effect code, got %v", name, r4Errors(r.Diagnostics))
			}
		})
	}
}
