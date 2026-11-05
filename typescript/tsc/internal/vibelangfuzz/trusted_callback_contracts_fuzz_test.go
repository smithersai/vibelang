package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestTrustedCallbackContractsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", foreignVariableQuote, foreignVariableWrittenQuote)
}

func FuzzTrustedCallbackContracts(f *testing.F) {
	startShortBudget(f)
	for i := uint8(0); i < 3; i++ {
		f.Add(i, true)
		f.Add(i, false)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, variation uint8, tagged bool) {
		TestTrustedCallbackContractsQuoted(t)
		name := []string{"SyntaxError", "TypeError", "RangeError"}[variation%3]
		contract := ""
		if tagged {
			contract = "/** @throws {" + name + "} */\n"
		}
		helper := contract + "export function parse(text:string):number {if(text==='') throw new " + name + "();return text.length}\n"
		source := "import {trusted} from 'vibelang-runtime'\nimport {parse} from './helper.js'\n" +
			"const parseTrusted=trusted(parse,[" + name + "])\n" +
			"export function invoke(" + name + ":number) {try {return parseTrusted('')} catch(e) {return -1}}\n"
		source = strings.Repeat("// callback contract\n", int(variation%3)) + source
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "helper.ts": helper}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 402 {
				t.Fatalf("unexpected diagnostic: %s", d.String())
			}
			got++
		}
		want := 0
		if !tagged {
			want = 1
		}
		if got != want {
			Gap(t, "FuzzTrustedCallbackContracts", fmt.Sprintf("%s/tagged=%t", name, tagged), "written callback contract: got %d EK0402, want %d", got, want)
		}
	})
}
