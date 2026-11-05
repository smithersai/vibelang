package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func TestCatchErrorDataAdvisoryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), "A plain handler whose result type is an Effect gets a VIP-38 lint warning") {
		t.Fatal("plain catch Effect-data advisory authority changed")
	}
}
func FuzzCatchErrorDataAdvisory(f *testing.F) {
	startShortBudget(f)
	for data := 0; data < 2; data++ {
		for shape := uint8(0); shape < 3; shape++ {
			f.Add(data == 1, shape, false)
			f.Add(data == 1, shape, true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data bool, shape uint8, bad bool) {
		TestCatchErrorDataAdvisoryQuoted(t)
		value := "e.id"
		if data {
			value = "e"
		}
		handler := []string{"(e)=>" + value, "(e)=>{return " + value + "}", "(e)=>(" + value + ")"}[shape%3]
		source := "error Absent {id:string}\neffect function failer(){throw new Absent({id:'lost'})}\nexport effect function run(){return failer() catch " + handler + "}"
		var want []string
		if bad {
			source += "\nexport const invalid:string=1;"
			want = []string{"TS2322"}
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		slices.Sort(got)
		warnings := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 508 {
				if d.Category() != diagnostics.CategoryWarning {
					t.Fatal("catch-data advisory changed severity")
				}
				warnings++
			}
		}
		r.Remove()
		expected := 0
		if data {
			expected = 1
		}
		if !slices.Equal(got, want) || warnings != expected {
			Gap(t, "FuzzCatchErrorDataAdvisory", fmt.Sprintf("%t/%d/%t", data, shape, bad), "data is returned without running it and its advisory coexists with native errors; got %v/%d want %v/%d", got, warnings, want, expected)
		}
	})
}
