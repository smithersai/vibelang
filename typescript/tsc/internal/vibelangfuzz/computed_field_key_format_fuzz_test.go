package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

var computedFieldFormatForms = []struct{ key, form string }{
	{"error-field", "error E { %s: number }"},
	{"error-readonly", "error E { readonly %s: number }"},
	{"error-optional", "error E { %s?: number }"},
	{"error-method", "error E { %s: number; read() { return 1 } }"},
	{"schema-error-field", "schema error E { %s: number }"},
	{"type-field", "type E = { %s: number }"},
	{"interface-field", "interface E { %s: number }"},
	{"type-method", "type E = { %s(): number }"},
	{"interface-method", "interface E { %s(): number }"},
	{"class-field", "class E { %s: number }"},
	{"return-type", "function f(): { %s: number } { return {} }"},
	{"module-type", "module native { export type E = { %s: number } }"},
}

var computedFieldFormatQuotes = map[string][]string{
	"003-failures.md": {
		"Admission depends on the expression shape as well as its type.",
	},
	"007-tooling.md": {
		"It preserves inferred and declared public types, declarations and throws contracts, and diagnostic codes, categories and occurrences; diagnostic locations and quoted source follow the formatted file.",
	},
}

func TestComputedFieldKeyFormattingQuoted(t *testing.T) {
	for chapter, quotes := range computedFieldFormatQuotes {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(text), quote) {
				t.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

func TestComputedFieldKeyFormattingKeys(t *testing.T) {
	seen := map[string]bool{}
	for _, form := range computedFieldFormatForms {
		if seen[form.key] {
			t.Fatalf("duplicate key %s", form.key)
		}
		seen[form.key] = true
		got, _ := computedFieldFormatInput(form.key + "\nmutation")
		if got != form.key {
			t.Fatalf("key %s selects %s", form.key, got)
		}
	}
}

func computedFieldFormatInput(data string) (string, string) {
	key, mutations, _ := strings.Cut(data, "\n")
	for _, form := range computedFieldFormatForms {
		if key == form.key {
			return key, mutations
		}
	}
	index := 0
	if len(data) > 0 {
		index = int(data[0]) % len(computedFieldFormatForms)
	}
	return computedFieldFormatForms[index].key, data
}

// A host may normally remove redundant expression groups. Field/type-member
// computed keys are an exception: Chapter 3 adopts native shape-sensitive key
// admission, and Chapter 7 requires diagnostic and declaration preservation.
// Vary the owning form, identifier/property key, nesting and enclosed comments;
// keyed corpus inputs keep their meaning when the form list grows.
func FuzzComputedFieldKeyFormatting(f *testing.F) {
	startShortBudget(f)
	for _, form := range computedFieldFormatForms {
		for _, mutation := range []string{"", "\x01\x02", "\x02\x01", "\x05\x01", "\x06\x02"} {
			f.Add(form.key + "\n" + mutation)
		}
	}
	f.Fuzz(func(t *testing.T, data string) {
		key, mutation := computedFieldFormatInput(data)
		expr, count, comment := "key", 1, ""
		if len(mutation) > 0 && mutation[0]&1 != 0 {
			expr = "keys.value"
		}
		if len(mutation) > 1 {
			count += int(mutation[1]) % 3
		}
		if len(mutation) > 0 && mutation[0]&2 != 0 {
			comment = "/* key */"
		}
		grouped := "[" + strings.Repeat("(", count) + comment + expr + strings.Repeat(")", count) + "]"
		bare := "[" + expr + "]"
		if len(mutation) > 0 && mutation[0]&4 != 0 {
			receiver := "keys"
			if mutation[0]&1 != 0 {
				receiver = "keys.nested"
			}
			grouped = "[" + strings.Repeat("(", count) + comment + receiver + strings.Repeat(")", count) + ".value]"
			bare = "[" + receiver + ".value]"
		}
		var source string
		for _, form := range computedFieldFormatForms {
			if form.key == key {
				source = fmt.Sprintf(form.form, grouped)
				break
			}
		}
		host := func(text string) (string, error) { return strings.ReplaceAll(text, grouped, bare), nil }
		once, err := vibelangfmt.Format("key.vibe", source, host)
		if err != nil {
			Gap(t, "FuzzComputedFieldKeyFormatting", "preserve:"+key, "grouped field key refused: %v\n%s", err, source)
			return
		}
		if !strings.Contains(once, grouped) {
			Gap(t, "FuzzComputedFieldKeyFormatting", "preserve:"+key, "grouped field key changed:\n%s\nthen:\n%s", source, once)
		}
		twice, err := vibelangfmt.Format("key.vibe", once, host)
		if err != nil || twice != once {
			Gap(t, "FuzzComputedFieldKeyFormatting", "stable:"+key, "second format changed output: %v\n%s\nthen:\n%s", err, once, twice)
		}
	})
}
