package vibelangfuzz

import (
	"fmt"
	"slices"
	"testing"
)

const trustedCallbackContractQuote = "unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function"

func TestTrustedCallbackContractsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", trustedCallbackContractQuote)
}

func FuzzTrustedCallbackContracts(f *testing.F) {
	startShortBudget(f)
	for i := range uint8(3) {
		f.Add(i, true)
		f.Add(i, false)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, variation uint8, handled bool) {
		TestTrustedCallbackContractsQuoted(t)
		name := []string{"SyntaxError", "TypeError", "RangeError"}[variation%3]
		helper := "/** @throws {" + name + "} */\nexport function parse(text:string): number { if (text === '') throw new " + name + "(); return text.length }\n"
		call := "return parse('')"
		want := []string{"EK0401"}
		if handled {
			call = "try { " + call + " } catch { return -1 }"
			want = nil
		}
		source := "import {parse} from './helper.js'\nexport function invoke(" + name + ": number) { " + call + " }\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "helper.ts": helper}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := fmt.Sprintf("%s/handled=%t", name, handled)
		if got := r3Errors(r.Diagnostics); !slices.Equal(got, want) {
			Gap(t, "FuzzTrustedCallbackContracts", key, "Chapter 3: %s; got %v, want %v", trustedCallbackContractQuote, got, want)
		}
		ExpectPending(t, "FuzzTrustedCallbackContracts", key)
	})
}
