package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestLexicalCaptureRetirementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), "VIP-6 permits lexical wrapper captures") {
		t.Fatal("lexical capture retirement authority changed")
	}
}
func FuzzLexicalCaptureRetirement(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 4; shape++ {
		f.Add(shape, false)
		f.Add(shape, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, bad bool) {
		TestLexicalCaptureRetirementQuoted(t)
		source := []string{
			"export function make(captured:number){return Effect.sync(()=>captured+1)}",
			"const captured=3;export const task=Effect.sync(()=>captured)",
			"export function make(captured:number){const thunk=()=>captured;return Effect.sync(thunk)}",
			"export function make(captured:number){return Effect.try(()=>captured)}",
		}[shape%4]
		var want []string
		if bad {
			source += "\nexport const invalid:number='text'"
			want = []string{"TS2322"}
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		slices.Sort(got)
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 4405 {
				t.Fatal("retired capture diagnostic was re-registered")
			}
		}
		r.Remove()
		if !slices.Equal(got, want) {
			Gap(t, "FuzzLexicalCaptureRetirement", fmt.Sprintf("%d/%t", shape, bad), "lexical wrapper captures are admitted while native type errors remain: got %v want %v", got, want)
		}
	})
}
