package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const catchClosureRunQuote = "`try e` is `yield* e`. It runs `e` and gives its success value."

func TestCatchClosureRunQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), catchClosureRunQuote) {
		t.Fatal("explicit execution quote changed")
	}
}

func FuzzCatchClosureRun(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"arrow", "function", "block"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestCatchClosureRunQuoted(t)
		optional := mode%2 == 0
		property := "read"
		if optional {
			property += "?"
		}
		body := "const later = effect () => try source.read(); return try later()"
		switch key {
		case "function":
			body = "effect function later() { return try source.read() }; return try later()"
		case "block":
			body = "const later = effect { return try source.read() }; return try later"
		default:
			key = "arrow"
		}
		source := "import { Effect } from 'effect'; interface Source { readonly " + property + ": () => Effect.Effect<number, string> }; export effect function probe(source: Source): number!! { if (source.read !== undefined) { return (effect { " + body + " }) catch () => 0 }; return 0 }"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		counts := map[string]int{}
		for _, code := range got {
			counts[code]++
		}
		ok := len(got) == 0
		if optional {
			ok = len(got) == 1 && counts["TS2722"] == 1
		}
		if !ok {
			Gap(t, "FuzzCatchClosureRun", fmt.Sprintf("%s/%d", key, mode%2), "running the nested Effect preserves only native closure errors: got %v", got)
		}
	})
}
