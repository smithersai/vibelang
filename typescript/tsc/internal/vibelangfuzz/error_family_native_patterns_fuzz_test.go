package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestErrorFamilyNativePatternsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), "a construct signature selects \x60instanceof\x60") {
		t.Fatal("native class pattern authority changed")
	}
}
func FuzzErrorFamilyNativePatterns(f *testing.F) {
	startShortBudget(f)
	for _, extract := range []bool{false, true} {
		for variation := uint8(0); variation < 3; variation++ {
			f.Add(extract, variation, false)
			f.Add(extract, variation, true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, extract bool, variation uint8, bad bool) {
		TestErrorFamilyNativePatternsQuoted(t)
		name := []string{"Child", "Missing", "Entry"}[variation%3]
		source := "class Base {constructor(readonly code:string){}}\nclass " + name + " extends Base {constructor(code:string,readonly path:string){super(code)}}\n"
		pattern := name + " and {path:let path}"
		body := "path"
		var want []string
		if extract {
			pattern = name + "(let item)"
			body = "'unused'"
			want = []string{"EK0704"}
		}
		source += "export function classify(value:unknown){return match(value){when " + pattern + ":" + body + ";when Base and {code:let code}:code;default:'other';}}"
		if bad {
			source += "\nexport const invalid:string=1"
			want = append(want, "TS2322")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzErrorFamilyNativePatterns", fmt.Sprintf("%t/%d/%t", extract, variation, bad), "native families use bare class and object patterns; unsupported extractors and independent native errors remain: got %v want %v", got, want)
		}
	})
}
