package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const reservedInheritanceTarget = "FuzzReservedPayloadInheritance"
const reservedPayloadQuote = "a `_tag` member in an `error` or `schema error` body"
const reservedInheritanceQuote = "an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form"

func TestReservedPayloadInheritanceQuoted(t *testing.T) {
	for _, quote := range []string{reservedPayloadQuote, reservedInheritanceQuote} {
		if !strings.Contains(SpecText("003-failures.md"), quote) {
			t.Fatalf("missing rule %q", quote)
		}
	}
}

type reservedInheritanceCase struct{ key, form, prefix, field string }

func reservedInheritanceCases() []reservedInheritanceCase {
	var cases []reservedInheritanceCase
	for _, form := range []struct{ key, text string }{{"error", "error"}, {"schema-error", "schema error"}} {
		for _, prefix := range []struct{ key, text string }{{"concrete", ""}, {"abstract", "abstract "}} {
			for _, field := range []struct{ key, text string }{{"plain", "_tag: string"}, {"quoted", "['_tag']: string"}, {"computed", "[\"_tag\"]: string"}, {"literal", "_tag: \"Other\""}, {"union", "_tag: \"Base\" | \"Other\""}} {
				cases = append(cases, reservedInheritanceCase{form.key + "/" + prefix.key + "/" + field.key, form.text, prefix.text, field.text})
			}
		}
	}
	return cases
}

// Chapter 3 assigns each independent source violation its own diagnostic.
// Remove either violation, then both, to check that neither masks the other.
func FuzzReservedPayloadInheritance(f *testing.F) {
	startShortBudget(f)
	cases := reservedInheritanceCases()
	for _, c := range cases {
		f.Add([]byte("key:" + c.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := slices.IndexFunc(cases, func(c reservedInheritanceCase) bool { return "key:"+c.key == string(data) })
		if i < 0 {
			i = 0
			for _, b := range data {
				i = (i*31 + int(b)) % len(cases)
			}
		}
		c := cases[i]
		for mask := 0; mask < 4; mask++ {
			field, base, want := "", "", 0
			if mask&1 != 0 {
				field = c.field
				want++
			}
			if mask&2 != 0 {
				base = " extends Base"
				want++
			}
			source := fmt.Sprintf("export %s%s Base { %s }\nexport %s Child%s {}\n", c.prefix, c.form, field, c.form, base)
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			errors := r4Errors(r.Diagnostics)
			r.Remove()
			good := len(errors) == want
			for _, code := range errors {
				good = good && code == "EK2117"
			}
			if !good {
				Gap(t, reservedInheritanceTarget, fmt.Sprintf("%s/mask-%d", c.key, mask), "Chapter 3 requires %d independent EK2117 diagnostics, got %v\n%s", want, errors, source)
			}
		}
	})
}
