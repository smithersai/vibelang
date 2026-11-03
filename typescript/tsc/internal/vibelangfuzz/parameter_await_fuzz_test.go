package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectParameterAwaitQuote = "Forbidden `await` in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`; forbidden `yield` there is `EK2104`."
const effectParameterBoundaryQuote = "Stop at a nested source callable or context boundary; an ordinary async callable or native generator keeps its own `await` or `yield` rules."

func TestEffectParameterAwaitQuoted(t *testing.T) {
	for _, quote := range []string{effectParameterAwaitQuote, effectParameterBoundaryQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("VIP-1 no longer says %q", quote)
		}
	}
}

func FuzzEffectParameterAwait(f *testing.F) {
	startShortBudget(f)
	for _, quote := range []string{effectParameterAwaitQuote, effectParameterBoundaryQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			f.Fatalf("VIP-1 no longer says %q", quote)
		}
	}
	keys := []string{"function", "exported", "expression", "arrow", "method", "object", "producer"}
	for _, key := range keys {
		for mutation := uint8(0); mutation < 4; mutation++ {
			f.Add(key, mutation)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		operand := []string{"Promise.resolve(1)", "1", "Effect.succeed(1)", "(undefined as any)"}[(mutation/4)%4]
		template := "effect function f(%s) { return value }"
		switch key {
		case "exported":
			template = "export effect function f(%s) { return value }"
		case "expression":
			template = "const f = effect function(%s) { return value }"
		case "arrow":
			template = "const f = effect (%s) => value"
		case "method":
			template = "class C { effect f(%s) { return value } }"
		case "object":
			template = "const c = { effect f(%s) { return value } }"
		case "producer":
			template = "effect function* f(%s) { yield value }"
		default:
			key = "function"
		}
		parameter := func(value string) string {
			switch mutation % 4 {
			case 1:
				return "{value = " + value + "} = {}"
			case 2:
				return "[value = " + value + "] = []"
			case 3:
				return "{[String(" + value + ")]: value}: Record<string, unknown> = {value: 1}"
			default:
				return "value = " + value
			}
		}
		check := func(value string, expected int32) {
			source := "import { Effect } from \"effect\"; " + fmt.Sprintf(template, parameter(value)) + "; export {}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			found := false
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d", d.Source(), d.Code()))
					found = found || IsEK(d) && d.Code() == expected
				}
			}
			if expected == 0 && len(errors) != 0 || expected != 0 && (!found || len(errors) != 1) {
				Gap(t, "FuzzEffectParameterAwait", key, "%s %s\nwant only EK%04d (zero means no errors), got %v\n%s", effectParameterAwaitQuote, effectParameterBoundaryQuote, expected, errors, source)
			}
		}
		check("await "+operand, 102)
		check("(async () => await Promise.resolve(1))", 0)
	})
}
