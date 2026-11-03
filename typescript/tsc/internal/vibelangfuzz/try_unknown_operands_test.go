package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const tryUnknownQuote = "`never` and `any` pass this test, `never` as the success of an Effect that only fails; `unknown` does not, as TypeScript doesn't assign it to `Effect.Effect<any, any, any>`"

func TestTryUnknownOperandsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), tryUnknownQuote) {
		t.Fatal("Chapter 2 operand test changed")
	}
}

// VIP-5's operand test is static assignability, including through calls,
// aliases and transparent expressions; any is the explicit unchecked escape.
func FuzzTryUnknownOperands(f *testing.F) {
	startShortBudget(f)
	shapes := []string{"value", "call", "grouped-call", "alias", "conditional", "assertion", "union", "intersection"}
	for _, key := range shapes {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
		f.Add(key, uint8(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestTryUnknownOperandsQuoted(t)
		found := false
		for _, shape := range shapes {
			if key == shape {
				found = true
				break
			}
		}
		if !found {
			if key == "" {
				return
			}
			key = shapes[int(key[0])%len(shapes)]
		}
		unchecked := variant&1 != 0
		typ := "unknown"
		if unchecked {
			typ = "any"
		}
		declaration := "type Input = " + typ + "; declare const input: Input; declare function make(): Input;\n"
		operand := map[string]string{"value": "input", "call": "make()", "grouped-call": "(make())", "alias": "held", "conditional": "(true ? input : make())", "assertion": "(0 as Input)", "union": "mixed", "intersection": "intersected"}[key]
		declaration += "declare const mixed: Effect.Effect<number> | Input; declare const intersected: Input & {};\n"
		body := "const held = input; return try " + operand
		if variant&2 != 0 {
			body = "return try effect { " + body + " }"
		}
		source := declaration + "export effect function probe() { " + body + " }\n"
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []string
		matched := false
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			errors = append(errors, diagnosticCodeName(d.Source(), d.Code()))
			if d.Source() == "EK" && d.Code() == 502 {
				matched = true
			}
		}
		gapKey := fmt.Sprintf("operand:%s:%d", key, variant%4)
		if unchecked && len(errors) > 0 || !unchecked && (!matched || len(errors) != 1) {
			Gap(t, "FuzzTryUnknownOperands", gapKey, "Chapter 2: %q; unchecked=%t; diagnostics=%v\n%s", tryUnknownQuote, unchecked, errors, source)
		}
	})
}
