package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const uncheckedTryAdviceQuote = "`try v` with `v: any` uses native delegation: a noniterable defects with `TypeError`; an unchecked iterable may complete normally"

// An unchecked result does not erase the callee's contract: the probes call
// an untagged .vibe callable with an any result, and a call through any
// itself keeps its own EK0403.
const uncheckedTryCalleeQuote = "Calls through `any` or `Function` throw `unknown`"

func TestTryUncheckedAdviceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), uncheckedTryAdviceQuote) {
		t.Fatalf("Chapter 2 no longer says %q", uncheckedTryAdviceQuote)
	}
	if !strings.Contains(SpecText("003-failures.md"), uncheckedTryCalleeQuote) {
		t.Fatalf("Chapter 3 no longer says %q", uncheckedTryCalleeQuote)
	}
}

const uncheckedTryCallee = "type Unchecked = { (...args: any[]): any; readonly field?: () => any }\n"

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
		probe := func(parameter string) string {
			source := fmt.Sprintf("export effect function probe(make: %s) { %s }", parameter, body)
			switch keys[index] {
			case "arrow":
				source = fmt.Sprintf("export const probe = effect (make: %s) => { %s }", parameter, body)
			case "expression":
				source = fmt.Sprintf("export const probe = effect function (make: %s) { %s }", parameter, body)
			case "method":
				source = fmt.Sprintf("export const object = { effect probe(make: %s) { %s } }", parameter, body)
			}
			return uncheckedTryCallee + source
		}
		compile := func(source string) []*ast.Diagnostic {
			var r *Result
			var err error
			within(t, "compile", func() { r, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			return r.Diagnostics
		}
		source := probe("Unchecked")
		for _, d := range compile(source) {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzTryUncheckedAdvice", "admission:"+keys[index], "VIP-5 admits unchecked try: %s%d\n%s", d.Source(), d.Code(), source)
			}
			if IsEK(d) && d.Code() == 4409 {
				Gap(t, "FuzzTryUncheckedAdvice", "explicit:"+keys[index], "VIP-5 executes unchecked try; advice falsely says no returned program runs: EK%d\n%s", d.Code(), source)
			}
		}
		// The same call through any throws unknown in effect code (chapter 3).
		source = probe("any")
		thrown := 0
		for _, d := range compile(source) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 403 {
				thrown++
				continue
			}
			Gap(t, "FuzzTryUncheckedAdvice", "callee:"+keys[index], "VIP-5 admits unchecked try; only the call's thrown type is an error: %s%d\n%s", d.Source(), d.Code(), source)
		}
		if thrown == 0 {
			Gap(t, "FuzzTryUncheckedAdvice", "callee:"+keys[index], "Chapter 3: %q; want EK0403 for the call through any\n%s", uncheckedTryCalleeQuote, source)
		}
	})
}
