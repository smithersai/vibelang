package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const catchRejectedFunctionHandlerQuote = "an `async` arrow or function expression, or a generator or `async` generator expression"

func TestCatchRejectedFunctionHandlerQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", catchRejectedFunctionHandlerQuote)
	chapterSays(t, "../vips/0034-compiler-and-tooling.md", catchAsyncDiagnosticQuote)
}

// A rejected generator or async function-expression handler is still the
// handler: its parameters take the failure's type, so EK0509 is the only
// diagnostic unless the body has its own native error.
func FuzzCatchRejectedFunctionHandler(f *testing.F) {
	startShortBudget(f)
	shapes := []string{"generator", "async-function", "async-generator", "named-async", "grouped-generator", "effect-generator"}
	parameters := []string{"untyped", "typed", "destructured", "two", "none"}
	variants := []string{"inferred", "body-error"}
	keys := []string{}
	for _, shape := range shapes {
		for _, parameter := range parameters {
			for _, variant := range variants {
				key := shape + "/" + parameter + "/" + variant
				keys = append(keys, key)
				f.Add([]byte(key), uint8(3))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, value uint8) {
		TestCatchRejectedFunctionHandlerQuoted(t)
		i, _ := keyedChoice(keys, data)
		parts := strings.Split(keys[i], "/")
		shape, parameter, variant := parts[0], parts[1], parts[2]
		list := map[string]string{"untyped": "(e)", "typed": "(e: string)", "destructured": "({ length })", "two": "(e, extra)", "none": "()"}[parameter]
		result := fmt.Sprint(value)
		want := []string{"EK0509"}
		body := ""
		if variant == "body-error" {
			body = "const bad: string = 7; void bad; "
			want = append(want, "TS2322")
		}
		if parameter == "two" {
			// More parameters than the handler signature: TypeScript gives the
			// function no contextual signature, so both parameters are implicit any.
			want = append(want, "TS7006", "TS7006")
		}
		if shape == "effect-generator" {
			want = append(want, "EK2128") // a producer may not return a value
		}
		statement := "{ " + body + "return " + result + " }"
		var handler string
		switch shape {
		case "generator":
			handler = "function* " + list + " " + statement
		case "async-function":
			handler = "async function " + list + " " + statement
		case "async-generator":
			handler = "async function* " + list + " " + statement
		case "named-async":
			handler = "async function recover " + list + " " + statement
		case "grouped-generator":
			handler = "(function* " + list + " " + statement + ")"
		case "effect-generator":
			handler = "effect function* " + list + " " + statement
		}
		source := "export effect function recover() { return Effect.fail(\"bad\") catch " + handler + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzCatchRejectedFunctionHandler", keys[i], "%s; want %v, got %v\n%s", catchAsyncDiagnosticQuote, want, got, source)
		}
	})
}
