package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestPlatformCallbackContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), "a type without \x60@throws\x60 admits only \x60never\x60") {
		t.Fatal("callback contract authority changed")
	}
}
func FuzzPlatformCallbackContract(f *testing.F) {
	startShortBudget(f)
	for _, never := range []bool{false, true} {
		for shape := uint8(0); shape < 3; shape++ {
			f.Add(never, shape, uint8(0))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, never bool, shape, variation uint8) {
		TestPlatformCallbackContractQuoted(t)
		foreign := "export function create(){return 1}"
		var want []string
		if never {
			foreign = "/** @throws {never} */\n" + foreign
		} else {
			want = []string{"EK0402"}
		}
		foreign += "\nexport function setup(cb:()=>unknown){return typeof cb}"
		arg := []string{"create", "(create)", "{create}.create"}[shape%3]
		source := "import {create,setup} from './foreign.js';\n" + strings.Repeat("// callback contract\n", int(variation%3)) + "export const configured=setup(" + arg + ");"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.ts": foreign}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzPlatformCallbackContract", fmt.Sprintf("%t/%d/%d", never, shape, variation), "callback contract checking is independent of callee ownership: got %v want %v", got, want)
		}
	})
}
