package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestMissingDataMethodQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "outside a declared Effect position") {
		t.Fatal("inferred argument advisory authority changed")
	}
}
func FuzzMissingDataMethod(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 3; shape++ {
		f.Add(shape, false)
		f.Add(shape, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, valid bool) {
		TestMissingDataMethodQuoted(t)
		receiver := "program"
		domain := "Effect.Effect<number>"
		member := []string{"runPromise()", "acquireRelease(effect () => Effect.void)", "fromNumberUnsafe()"}[shape%3]
		if shape%3 == 2 {
			receiver = "value"
			domain = "BigDecimal.BigDecimal"
		}
		body := receiver + "." + member
		var want []string
		if valid {
			body = receiver
		} else {
			want = []string{"TS2339"}
		}
		source := "export function inspect(" + receiver + ":" + domain + "){return " + body + "}"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		slices.Sort(got)
		advice := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 4802 {
				advice++
			}
		}
		r.Remove()
		if !slices.Equal(got, want) || advice != 0 {
			Gap(t, "FuzzMissingDataMethod", fmt.Sprintf("%d/%t", shape, valid), "missing data members retain native lookup errors without inventing an inferred Effect argument contract; got %v, advice=%d", got, advice)
		}
	})
}
