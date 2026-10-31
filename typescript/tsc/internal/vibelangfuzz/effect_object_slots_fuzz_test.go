package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectObjectSlotQuote = "A required error or requirement slot admits an ordinary object type"
const effectOptionalObjectQuote = "The unparenthesized `{` exclusion applies only to the optional `R` after `!!`"
const effectObjectSlotDanglingQuote = "A `!` after a type with no slot and no second `!` after it on its line is a syntax error"

func requireEffectObjectSlotQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectObjectSlotQuote, effectOptionalObjectQuote, effectObjectSlotDanglingQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing Effect object slot rule: %q", quote)
		}
	}
}
func TestEffectObjectSlotsQuoted(t *testing.T) { requireEffectObjectSlotQuotes(t) }

// The equality proof checks the channels against an ordinary Effect type.
// This is a static type oracle; it adds no runtime differential runner.
func FuzzEffectObjectTypeSlots(f *testing.F) {
	startShortBudget(f)
	requireEffectObjectSlotQuotes(f)
	for _, key := range []string{"required-R", "both-objects", "callable", "property", "method", "tuple", "array", "legacy-body", "optional-R-parenthesized", "optional-R-excluded", "next-line-block"} {
		for _, mode := range []uint8{0, 1, 2} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		scalar := []string{"number", "string", "boolean"}[mode%3]
		value := []string{"1", "'value'", "true"}[mode%3]
		gap := []string{" ", "\t", " /* slot */ "}[mode%3]
		requirement := "{ readonly service: " + scalar + " }"
		short := scalar + "!string!" + gap + requirement
		expanded := "Effect.Effect<" + scalar + ", string, " + requirement + ">"
		source := "type Value = " + short
		switch key {
		case "both-objects":
			source = "type Value = " + scalar + "!{ readonly why: string }!" + gap + requirement
			expanded = "Effect.Effect<" + scalar + ", { readonly why: string }, " + requirement + ">"
		case "callable":
			source = "type Value = () => " + short
			expanded = "() => " + expanded
		case "property":
			source = "type Value = { run: " + short + " }"
			expanded = "{ run: " + expanded + " }"
		case "method":
			source = "interface Value { read(): " + short + " }"
			expanded = "{ read(): " + expanded + " }"
		case "tuple":
			source = "type Value = [" + short + "]"
			expanded = "[" + expanded + "]"
		case "array":
			source = "type Value = (" + short + ")[]"
			expanded = "(" + expanded + ")[]"
		case "legacy-body":
			source = "effect function load(): " + scalar + "!string!" + gap + "{ return " + value + " }; type Value = ReturnType<typeof load>"
			expanded = "Effect.Effect<" + scalar + ", string, never>"
		case "optional-R-parenthesized":
			source = "type Value = " + scalar + "!!(" + requirement + ")"
			expanded = "Effect.Effect<" + scalar + ", never, " + requirement + ">"
		case "optional-R-excluded":
			// The exclusion matters where a body follows the type: a function
			// return annotation. A type alias cannot be followed by a block.
			source = "effect function load(): " + scalar + "!!" + gap + "{ return " + value + " }; type Value = ReturnType<typeof load>"
			expanded = "Effect.Effect<" + scalar + ">"
		case "next-line-block":
			source = "type Value = " + scalar + "!string!\n{}"
			expanded = "Effect.Effect<" + scalar + ", string, never>"
		default:
			key = "required-R"
		}
		source += "; type Same<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false; type Check<T extends true> = T; type Proof = Check<Same<Value, " + expanded + ">>"
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzEffectObjectTypeSlots", "effect-object-slot:"+key, "%s; %s\n%s\n%s", effectObjectSlotQuote, effectOptionalObjectQuote, source, fmt.Sprint(result.Diagnostics))
				break
			}
		}
	})
}
