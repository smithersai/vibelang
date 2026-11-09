package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const nativeValueBoundaryQuote = "Synchronous defect bridges use \x60Effect.orDie(Effect.try({ try: () => call(), catch: (e) => e }))\x60."

func TestNativeValueDefectBoundaryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../../../.smithers/flows/migrate/rules.md"), nativeValueBoundaryQuote) {
		t.Fatal(nativeValueBoundaryQuote)
	}
}

func FuzzNativeValueDefectBoundary(f *testing.F) {
	startShortBudget(f)
	for variation := uint8(0); variation < 4; variation++ {
		f.Add(variation, true)
		f.Add(variation, false)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, variation uint8, boundary bool) {
		TestNativeValueDefectBoundaryQuoted(t)
		helper := "export function read():number|undefined {return undefined}\n"
		if variation&1 != 0 {
			helper = "/** @throws {unknown} */\n" + helper
		}
		imports := "import {read} from './host.js'\n"
		invocation := "read()"
		if variation&2 != 0 {
			imports = "import * as Native from './host.js'\n"
			invocation = "Native.read()"
		}
		expression := invocation
		if boundary {
			expression = "try Effect.orDie(Effect.try({try:()=>" + invocation + ",catch:(error)=>error}))"
		}
		source := strings.Repeat("// native value boundary\n", int(variation%3)) + imports + "export effect function probe(){return " + expression + "}\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "host.ts": helper}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 403 {
				t.Fatalf("unexpected diagnostic: %s", d.String())
			}
			got++
		}
		want := 1
		if boundary {
			want = 0
		}
		if got != want {
			Gap(t, "FuzzNativeValueDefectBoundary", fmt.Sprintf("%d/boundary=%t", variation, boundary), "explicit synchronous defect boundary: got %d EK0403, want %d", got, want)
		}
	})
}
