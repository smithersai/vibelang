package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const dynamicRecoveryQuote = "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives."

func TestDynamicCallRecoveryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), dynamicRecoveryQuote) {
		t.Fatal("dynamic call contract quote changed")
	}
}

func FuzzDynamicCallRecovery(f *testing.F) {
	startShortBudget(f)
	keys := []string{"any", "member", "cast", "missing-name", "missing-member", "typed"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestDynamicCallRecoveryQuoted(t)
		params, call, want := "value: any", "value()", "EK0403"
		switch key {
		case "member":
			call = "value.run(1)"
		case "cast":
			params, call = "value: unknown", "(value as any)()"
		case "missing-name":
			params, call, want = "", "notDeclared()", "TS2304"
		case "missing-member":
			params, call, want = "value: { present: number }", "value.missing()", "TS2339"
		case "typed":
			params, want = "value: () => number", ""
		default:
			key = "any"
		}
		body := "return " + call
		if mode%2 == 1 {
			body = "try Effect.yieldNow; " + body
		}
		source := "import { Effect } from 'effect'; export effect function probe(" + params + ") { " + body + " }"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		if (want == "" && len(got) != 0) || (want != "" && (len(got) != 1 || got[0] != want)) {
			Gap(t, "FuzzDynamicCallRecovery", fmt.Sprintf("%s/%d", key, mode%2), "dynamic and unresolved calls retain independent diagnostics: got %v, want %s", got, want)
		}
	})
}
