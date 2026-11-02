package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const schemaErrorEffectKeyQuote = "A computed class key and an `extends` clause are effect code, as `await` is allowed there"
const schemaErrorFieldMappingQuote = "Each field's type is mapped as in a `schema` declaration, optional properties included."

func TestSchemaErrorEffectKeysQuoted(t *testing.T) {
	schemaErrorEffectKeysQuoted(t)
}

func schemaErrorEffectKeysQuoted(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{
		"002-running.md":  schemaErrorEffectKeyQuote,
		"003-failures.md": schemaErrorFieldMappingQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
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
	if len(keys) != 24 {
		t.Fatalf("got %d rules, want 24", len(keys))
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
