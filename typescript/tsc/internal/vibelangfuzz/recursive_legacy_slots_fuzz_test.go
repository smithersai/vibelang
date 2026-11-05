package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const recursiveLegacySlotQuote = "\x60EK4857\x60 replaces \x60TS1338\x60 for the same immediate written \x60infer\x60 channel"
const recursiveLegacyCycleQuote = "the legacy partial-contract inference cannot break its call cycle"

func TestRecursiveLegacySlotsQuoted(t *testing.T) {
	for _, r := range []struct{ chapter, quote string }{{"001-functions.md", recursiveLegacySlotQuote}, {"900-appendices.md", recursiveLegacyCycleQuote}} {
		if !strings.Contains(SpecText(r.chapter), r.quote) {
			t.Fatal(r.quote)
		}
	}
}
func FuzzRecursiveLegacySlots(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 3; shape++ {
		f.Add(shape, uint8(0))
		f.Add(shape, uint8(4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape, variation uint8) {
		TestRecursiveLegacySlotsQuoted(t)
		name := []string{"repeat", "recur", "step"}[variation%3]
		params := "(n:number)"
		generic := ""
		body := "return n===0?0:Math.max(try " + name + "(n-1),n)"
		if shape%3 == 1 {
			body = "return n===0?0:(try " + name + "(n-1)||n)"
		}
		if shape%3 == 2 {
			generic = "<T>"
			params = "(xs:ReadonlyArray<T>,n:number)"
			body = "return xs.length===0?n:1+try " + name + "(xs.slice(1),n)"
		}
		for _, partial := range []bool{true, false} {
			annotation := "Effect.Effect<number,Neg,never>"
			want := []string{}
			if partial {
				annotation = "Effect.Effect<number,Neg,infer R>"
				want = []string{"EK4857", "EK9206"}
			}
			source := strings.Repeat("// recursive slot control\n", int(variation%3)) + "error Neg {n:number}\nexport effect function " + name + generic + params + ":" + annotation + "{if(n<0)throw new Neg({n});" + body + "}\n"
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			got := r3Errors(r.Diagnostics)
			r.Remove()
			slices.Sort(got)
			if !slices.Equal(got, want) {
				Gap(t, "FuzzRecursiveLegacySlots", fmt.Sprintf("%d/%d/partial=%t", shape%3, variation, partial), "legacy slot and call-cycle diagnostics; complete contracts compile: got %v, want %v\n%s", got, want, source)
			}
		}
	})
}
