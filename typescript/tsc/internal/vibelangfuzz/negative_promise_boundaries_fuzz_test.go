package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const negativePromiseRunnerQuote = "a root runner is called inside code already running on a fiber."
const negativePromiseHostQuote = "a global declared by \x60lib.dom\x60"

func TestNegativePromiseBoundariesQuoted(t *testing.T) {
	TestPromiseResultGateQuoted(t)
	for _, quote := range []string{negativePromiseRunnerQuote, negativePromiseHostQuote} {
		if !strings.Contains(SpecText("900-appendices.md"), quote) {
			t.Fatal(quote)
		}
	}
}

func FuzzNegativePromiseBoundaries(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"runner", "fetch", "async", "foreign"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
		f.Add(key, uint8(4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variation uint8) {
		TestNegativePromiseBoundariesQuoted(t)
		prefix := ""
		expression := ""
		want := []int32{}
		switch key {
		case "runner":
			expression = "Effect.runPromise(Effect.succeed(1))"
			want = []int32{404, 1005}
		case "fetch":
			expression = "fetch('https://example.invalid/')"
			if variation&1 != 0 {
				expression = "globalThis." + expression
			}
			want = []int32{404, 4402}
		case "async":
			prefix = "async function pending(){return 1}\n"
			expression = "pending()"
			want = []int32{404}
		default:
			key = "foreign"
			prefix = "import {plain} from './foreign.js'\n"
			expression = "plain()"
			want = []int32{403}
		}
		source := strings.Repeat("// independent boundary diagnostics\n", int(variation%3)) + prefix + "export effect function probe(){return " + expression + "}\n"
		files := map[string]string{"main.vibe": source, "foreign.ts": "export function plain(){return 'value'}\n"}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []int32
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				if !IsEK(d) {
					t.Fatalf("unexpected native error %s", d.String())
				}
				got = append(got, d.Code())
			}
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzNegativePromiseBoundaries", fmt.Sprintf("%s/%d", key, variation), "independent Promise and host/runner rules: got %v, want %v\n%s", got, want, source)
		}
	})
}
