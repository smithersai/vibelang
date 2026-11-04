package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const returnedProgramTarget = "FuzzReturnedProgramTrigger"
const returnedProgramQuote = "An `effect` `return e` keeps `e` as its success value, including an inner Effect left unrun; write `return try e` to run it"

func TestReturnedProgramTriggerQuoted(t *testing.T) {
	text := SpecText("002-running.md")
	for _, quote := range []string{returnedProgramQuote, effectGenericArgumentQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Chapter 2 no longer says %q", quote)
		}
	}
}

// Keyed mutations cover the deleted return classifiers and keep a positive
// inferred-argument control in the same body. Changing the owner or expression
// does not turn return data into an inferred argument.
func FuzzReturnedProgramTrigger(f *testing.F) {
	startShortBudget(f)
	shapes := []struct{ key, expression string }{
		{"effect", "e"},
		{"effect-call", "Effect.succeed(7)"},
		{"subtype", "Exit.succeed(7)"},
		{"program", "factory"},
		{"literal", "() => e"},
		{"union", "maybe"},
		{"conditional", "flag ? e : 7"},
		{"nullish", "n ?? e"},
	}
	for i, shape := range shapes {
		f.Add(shape.key, uint8(i%4), i%2 == 0)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8, argument bool) {
		TestReturnedProgramTriggerQuoted(t)
		index := slices.IndexFunc(shapes, func(s struct{ key, expression string }) bool { return s.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(shapes)
		}
		shape := shapes[index]
		mode := mutation % 4
		call := ""
		want := 0
		if argument {
			call = "const observed = take(e); "
			if mode != 0 {
				want = 1
			}
		}
		body := call + "return " + shape.expression
		parameters := "flag: boolean, n: number | undefined, maybe: (number!!) | undefined"
		var owner string
		switch mode {
		case 0:
			owner = "export function probe(" + parameters + ") { " + body + " }"
		case 1:
			owner = "export effect function probe(" + parameters + ") { " + body + " }"
		case 2:
			owner = "export const probe = effect (" + parameters + "): unknown!! => { " + body + " }"
		case 3:
			owner = "export const probe = effect (" + parameters + ") => { return try (effect { " + body + " }) }"
		}
		source := "const e = Effect.succeed(7); const factory = () => e; function take<T>(x: T): number { return 1 }\n" + owner + "\n"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4802 {
				count++
			}
		}
		key = fmt.Sprintf("%s:owner-%d:argument-%t", shape.key, mode, argument)
		if count != want || HasError(result.Diagnostics) {
			Gap(t, returnedProgramTarget, key, "VIP-1/5: want %d inferred-argument warnings and no return warning, got %d: %v\n%s", want, count, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, returnedProgramTarget, key)
		ExpectPending(t, returnedProgramTarget, specCorpusKey(t))
	})
}
