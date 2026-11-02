package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentOperandTarget = "FuzzConcurrentOperandDiagnostics"
const concurrentOperandQuote = "an operand that is not an `Iterable`, `for concurrent (const x of 5) { }`; the test is assignability to `Iterable<unknown>`; a Stream uses `for try`"

func TestConcurrentOperandQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentOperandQuote) {
		t.Fatalf("stale concurrent operand quote: %s", concurrentOperandQuote)
	}
}

func FuzzConcurrentOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), concurrentOperandQuote) {
		f.Fatal("stale concurrent operand quote")
	}
	rules := []struct {
		key, typ string
		allowed  bool
	}{
		{"any", "any", true}, {"never", "never", true},
		{"readonly", "readonly number[]", true}, {"string", "string", true},
		{"set", "Set<number>", true}, {"iterable", "Iterable<number>", true},
		{"union-arrays", "string[] | number[]", true},
		{"union-containers", "number[] | Set<string>", true},
		{"union-same-item", "number[] | Set<number>", true},
		{"unknown-items", "Iterable<unknown>", true},
		{"iterable-stream", "Stream.Stream<number> & Iterable<number>", true},
		{"mixed-iterable-number", "number[] | number", false},
		{"invalid-iterator", "{ [Symbol.iterator](): number }", false},
		{"unknown", "unknown", false}, {"number", "number", false},
		{"optional", "readonly number[] | undefined", false},
		{"stream", "Stream.Stream<number>", false},
		{"async-iterable", "AsyncIterable<number>", false},
	}
	for _, rule := range rules {
		f.Add(rule.key)
		if !rule.allowed {
			f.Add(rule.key + ":2")
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		baseKey, tail, _ := strings.Cut(key, ":")
		depth := 0
		if len(tail) != 0 {
			depth = int(tail[0]) % 6
		}
		index := slices.IndexFunc(rules, func(rule struct {
			key, typ string
			allowed  bool
		}) bool {
			return rule.key == baseKey
		})
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		operand := strings.Repeat("(", depth) + "input" + strings.Repeat(")", depth)
		source := fmt.Sprintf("import { Stream } from \"effect\"\nexport effect function probe(input: %s) { for concurrent (const item of %s) { } }", rule.typ, operand)
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		hasError, hasOperandError := false, false
		errorCount := 0
		for _, diagnostic := range r.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				hasError = true
				errorCount++
				hasOperandError = hasOperandError || diagnostic.Source() == "EK" && diagnostic.Code() == 1901
			}
		}
		if rule.allowed && hasOperandError {
			Gap(t, concurrentOperandTarget, "classification:"+rule.key, "%s; an Iterable must not be EK1901\n%s\n%v", concurrentOperandQuote, source, Keys(r.Dir, r.Diagnostics))
		}
		if rule.allowed && hasError {
			Gap(t, concurrentOperandTarget, "compile:"+rule.key, "%s; a valid Iterable must compile\n%s\n%v", concurrentOperandQuote, source, Keys(r.Dir, r.Diagnostics))
		}
		if !rule.allowed && (!hasOperandError || errorCount != 1) {
			Gap(t, concurrentOperandTarget, rule.key, "%s; expected exactly one EK1901\n%s\n%v", concurrentOperandQuote, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, concurrentOperandTarget, "classification:"+rule.key)
		ExpectPending(t, concurrentOperandTarget, "compile:"+rule.key)
		ExpectPending(t, concurrentOperandTarget, rule.key)
		ExpectPending(t, concurrentOperandTarget, specCorpusKey(t))
	})
}
