package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestPatternPredicateContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), "a type without \x60@throws\x60 admits only \x60never\x60") {
		t.Fatal("predicate callback contract authority changed")
	}
}
func FuzzPatternPredicateContract(f *testing.F) {
	startShortBudget(f)
	for _, wrapped := range []bool{false, true} {
		for shape := uint8(0); shape < 3; shape++ {
			f.Add(wrapped, shape, false)
			f.Add(wrapped, shape, true)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, wrapped bool, shape uint8, bad bool) {
		TestPatternPredicateContractQuoted(t)
		foreign := "export function predicate(value:unknown):value is Error{return value instanceof Error}"
		source := "import {predicate} from './foreign.js';\n"
		name := "predicate"
		var want []string
		if wrapped {
			name = "admitted"
			source += []string{"function admitted(value:unknown):value is Error{return predicate(value)}", "const admitted=(value:unknown):value is Error=>predicate(value)", "const admitted=(value:unknown):value is Error=>{return predicate(value)}"}[shape%3] + "\n"
		} else {
			want = []string{"EK0402"}
		}
		source += "export function matches(value:unknown){return value is " + name + "}"
		if bad {
			source += "\nexport const invalid:string=1"
			want = append(want, "TS2322")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.ts": foreign}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzPatternPredicateContract", fmt.Sprintf("%t/%d/%t", wrapped, shape, bad), "foreign pattern callbacks retain their contract check and source callables retain never: got %v want %v", got, want)
		}
	})
}
