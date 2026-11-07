package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const primitiveClassNarrowingTarget = "FuzzPrimitiveClassNarrowing"

var primitiveClassNarrowingQuotes = []string{
	"test the primitive or its boxed object, `typeof s === \"string\" || s instanceof String`",
	"Inside an arm the subject narrows as the arm's test narrows in TypeScript",
}

// Each key is a primitive class; the mode picks the subject and the form.
var primitiveClassNarrowingKeys = []string{"String", "Number", "Boolean", "BigInt", "Symbol"}
var primitiveClassNarrowingTypes = map[string]string{"String": "string", "Number": "number", "Boolean": "boolean", "BigInt": "bigint", "Symbol": "symbol"}

func primitiveClassNarrowingQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("004-match.md")
	for _, quote := range primitiveClassNarrowingQuotes {
		if !strings.Contains(text, quote) {
			t.Fatalf("primitive class pattern authority changed: %q", quote)
		}
	}
}
func TestPrimitiveClassNarrowingQuoted(t *testing.T) { primitiveClassNarrowingQuoted(t) }

// A static check: the type an arm or is branch gives the subject equals the
// type TypeScript gives it after the quoted test. The paired compiler case
// compares the run-time results.
func FuzzPrimitiveClassNarrowing(f *testing.F) {
	startShortBudget(f)
	primitiveClassNarrowingQuoted(f)
	for _, key := range primitiveClassNarrowingKeys {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(primitiveClassNarrowingKeys, key) {
			key = primitiveClassNarrowingKeys[int(mode)%len(primitiveClassNarrowingKeys)]
		}
		mode %= 8
		primitive := primitiveClassNarrowingTypes[key]
		both := primitive + " | " + key
		subject, want, form := "unknown", both, "when "+key
		if mode&1 != 0 {
			subject = both + " | readonly number[]"
		}
		if mode&2 != 0 {
			form = "not " + key
			want = "readonly number[]"
			if mode&1 == 0 {
				want = "unknown"
			}
		}
		var body string
		if mode&4 != 0 {
			test := "s is " + key
			if mode&2 != 0 {
				test = "!(s is " + key + ")"
			}
			body = "if (" + test + ") { return true satisfies Eq<typeof s, " + want + "> } return false"
		} else {
			body = "return match (s) { when " + strings.TrimPrefix(form, "when ") + ": (true satisfies Eq<typeof s, " + want + ">); default: false; }"
		}
		source := "type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
			"export function f(s: " + subject + ") { " + body + " }\n"
		gapKey := fmt.Sprintf("narrow:%s:%d", key, mode)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, primitiveClassNarrowingTarget, gapKey, "%s: unexpected %s\n%s", primitiveClassNarrowingQuotes[0], specDiagnosticText(d), source)
				return
			}
		}
	})
}
