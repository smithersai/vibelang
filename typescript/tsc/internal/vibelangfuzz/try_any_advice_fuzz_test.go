package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const uncheckedTryAdviceQuote = "`try v` with `v: any` uses native delegation: a noniterable defects with `TypeError`; an unchecked iterable may complete normally"

func TestTryUncheckedAdviceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), uncheckedTryAdviceQuote) {
		t.Fatalf("Chapter 2 no longer says %q", uncheckedTryAdviceQuote)
	}
}

func FuzzTryUncheckedAdvice(f *testing.F) {
	startShortBudget(f)
	keys := []string{"function", "arrow", "expression", "method", "optional", "grouped", "member-call", "computed-call", "do-argument", "running-argument"}
	for _, key := range keys {
		for _, variant := range []uint8{0, 1, 2, 3} {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestTryUncheckedAdviceQuoted(t)
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(keys)
		}
		operand := "try make()"
		if keys[index] == "optional" {
			operand = "try make?.()"
		}
		if keys[index] == "grouped" {
			operand = "try (make())"
		}
		switch keys[index] {
		case "member-call":
			operand = "try make.field?.()"
		case "computed-call":
			operand = "try make[\"field\"]?.()"
		case "do-argument":
			operand = "try make(do { 1 })"
		case "running-argument":
			operand = "try make(try Effect.succeed(1))"
		}
		body := "return " + operand
		switch variant % 4 {
		case 1:
			body = "return try effect { return " + operand + " }"
		case 2:
			body = "const value = " + operand + "; return value"
		case 3:
			body = "return true ? " + operand + " : 0"
		}
		source := fmt.Sprintf("export effect function probe(make: any) { %s }", body)
		switch keys[index] {
		case "arrow":
			source = fmt.Sprintf("export const probe = effect (make: any) => { %s }", body)
		case "expression":
			source = fmt.Sprintf("export const probe = effect function (make: any) { %s }", body)
		case "method":
			source = fmt.Sprintf("export const object = { effect probe(make: any) { %s } }", body)
		}
		var r *Result
		var err error
		within(t, "compile", func() { r, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzTryUncheckedAdvice", "admission:"+keys[index], "VIP-5 admits unchecked try: %s%d\n%s", d.Source(), d.Code(), source)
			}
			if IsEK(d) && d.Code() == 4409 {
				Gap(t, "FuzzTryUncheckedAdvice", "explicit:"+keys[index], "VIP-5 executes unchecked try; advice falsely says no returned program runs: EK%d\n%s", d.Code(), source)
			}
		}
	})
}
