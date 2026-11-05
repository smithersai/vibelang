package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestPlainUnknownContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), "stays an ordinary call") {
		t.Fatal("plain unknown foreign-call authority changed")
	}
}
func FuzzPlainUnknownContract(f *testing.F) {
	startShortBudget(f)
	for mode := uint8(0); mode < 4; mode++ {
		for shape := uint8(0); shape < 3; shape++ {
			f.Add(mode, shape, uint8(0))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode, shape, variation uint8) {
		TestPlainUnknownContractQuoted(t)
		mode %= 4
		shape %= 3
		foreign := "export function foreign(n:number){return n+1}"
		var want []string
		if mode == 1 || mode == 3 {
			foreign = "/** @throws {RangeError} */\n" + foreign
		}
		body := []string{"return foreign(n)", "const result=foreign(n);return result", "return n>0?foreign(n):0"}[shape]
		prefix := ""
		if mode == 2 {
			prefix = "effect "
			want = []string{"EK0403"}
		}
		if mode == 1 {
			want = []string{"EK0401"}
		}
		if mode == 3 {
			body = "try{" + body + "}catch{return 0}"
		}
		source := "import {foreign} from './foreign.js';\n" + strings.Repeat("// call boundary\n", int(variation%3)) + "export " + prefix + "function probe(n:number){" + body + "}"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "foreign.ts": foreign}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzPlainUnknownContract", fmt.Sprintf("%d/%d/%d", mode, shape, variation), "unknown plain calls remain native; effect and known-throwing calls retain their errors: got %v want %v", got, want)
		}
	})
}
