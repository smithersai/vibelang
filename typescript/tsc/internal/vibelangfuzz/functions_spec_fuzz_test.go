package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// functionsLegacyRow names the row of chapter 1's diagnostics table that gives
// the code for every banned use of legacy JavaScript.
const functionsLegacyRow = "A banned use of `eval`, `Function`, `arguments`, `var` or `with`"

// chapterCode reads the EK code of the line naming needle, preferring a table
// row, so a renumbering moves the oracle with the chapter.
func chapterCode(f *testing.F, chapter []byte, needle string) int32 {
	f.Helper()
	var prose int32
	for line := range strings.Lines(string(chapter)) {
		if !strings.Contains(line, needle) {
			continue
		}
		matches := ekCode.FindAllStringSubmatch(line, -1)
		if len(matches) == 0 {
			continue
		}
		code, err := strconv.ParseInt(matches[len(matches)-1][1], 10, 32)
		if err != nil {
			f.Fatal(err)
		}
		if strings.HasPrefix(line, "|") {
			return int32(code)
		}
		if prose == 0 {
			prose = int32(code)
		}
	}
	if prose == 0 {
		f.Fatalf("no line of the chapter gives an EK code for %q", needle)
	}
	return prose
}

// FuzzFunctionsSpec reads the current chapter, rather than a retired rules
// table. Each input selects one violation and one source function kind.
func FuzzFunctionsSpec(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	type rule struct{ key, quote, source string }
	rules := []rule{
		{"arguments", "every `IdentifierReference` named `arguments`", "return arguments.length"},
		{"var", "every `var` declaration", "var x = 1; return x"},
		{"eval", "every `IdentifierReference` named `eval`", "return (0, eval)(\"1\")"},
		{"function-alias", "every `IdentifierReference` resolving to the global `Function` constructor", "const F = Function; return F"},
		{"with", "every `with` statement", "with ({x: 1}) { x }"},
		{"await", "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", "await Promise.resolve(1)"},
		{"var-loop", "`for (var …)` included", "for (var x of [1, 2]) {} return 0"},
	}
	codes := map[string]int32{}
	for _, r := range rules {
		if !strings.Contains(string(chapter), r.quote) {
			f.Fatalf("chapter 1 no longer says %q", r.quote)
		}
		row := functionsLegacyRow
		if r.key == "await" {
			row = r.quote
		}
		codes[r.key] = chapterCode(f, chapter, row)
	}
	w := NewWorkspace(f)
	for i := range rules {
		for form := range 5 {
			f.Add(uint8(i), uint8(form))
		}
	}
	f.Fuzz(func(t *testing.T, ri, form uint8) {
		r := rules[int(ri)%len(rules)]
		head, tail := "export effect function main() {", "}"
		if r.key != "await" {
			switch form % 5 {
			case 1:
				head = "export function main() {"
			case 2:
				head = "export const main = () => {"
			case 3:
				head = "export async function main() {"
			case 4:
				head, tail = "export {};\n", ""
			}
		}
		body := r.source
		if tail == "" {
			body = strings.ReplaceAll(body, "return ", "void ")
		}
		source := head + body + tail
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		var got []string
		code := codes[r.key]
		for _, d := range result.Diagnostics {
			got = append(got, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			if d.Source() == "EK" && d.Code() == code && d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		key := "rule:" + r.key
		if !found {
			Gap(t, "FuzzFunctionsSpec", key, "%s; expected EK%04d\n%s\n%v", r.quote, code, source, got)
		}
		ExpectPending(t, "FuzzFunctionsSpec", key)
	})
}

// FuzzFunctionBoundaries checks the independent static boundaries in chapter
// 1. A feature key names precisely the syntax rejected by its rule.
func FuzzFunctionBoundaries(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	cases := []struct{ key, quote, source string }{
		{"shorthand", "There is no top-level shorthand", "effect load() {}"},
		{"async-shorthand", "There is no top-level shorthand", "async load() {}"},
		{"await-using", "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", "effect function f() { await using r = { [Symbol.asyncDispose]: async () => {} } }"},
		{"for-await", "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block", "effect function f() { for await (const x of []) {} }"},
		{"await-effect", "`await` on an Effect, by the [Result test](002-running.md#result-tests)", "async function f() { await Effect.succeed(1) }"},
		{"getter", "`effect` on a getter, setter or constructor", "class C { effect get x() { return 1 } }"},
		{"setter", "`effect` on a getter, setter or constructor", "class C { effect set x(v: number) {} }"},
		{"constructor", "`effect` on a getter, setter or constructor", "class C { effect constructor() {} }"},
		{"both", "`effect` and `async` on one function", "effect async function f() {}"},
		{"return-type", "A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`", "effect function f(): number { return 1 }"},
		{"arguments-default", "every `IdentifierReference` named `arguments`", "function f(p = arguments.length) {}"},
		{"await-effect-top", "`await` on an Effect, by the [Result test](002-running.md#result-tests)", "await Effect.succeed(1)"},
		{"await-effect-union", "`await` on an Effect, by the [Result test](002-running.md#result-tests)", "async function f(x: number | (number!!)) { await x }"},
		{"return-type-any", "A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`", "effect function f(): any { return 1 }"},
		{"return-type-unknown", "A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`", "effect function f(): unknown { return 1 }"},
	}
	codes := map[string]int32{}
	for _, c := range cases {
		if !strings.Contains(string(chapter), c.quote) {
			f.Fatalf("chapter 1 no longer says %q", c.quote)
		}
		row := c.quote
		if c.key == "arguments-default" {
			row = functionsLegacyRow
		}
		codes[c.key] = chapterCode(f, chapter, row)
	}
	w := NewWorkspace(f)
	for i := range cases {
		f.Add(uint8(i))
	}
	f.Fuzz(func(t *testing.T, n uint8) {
		c := cases[int(n)%len(cases)]
		result, err := w.Compile(context.Background(), Single("import { Effect } from \"effect\";\n"+c.source+"\nexport {}"))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var got []string
		found := false
		code := codes[c.key]
		for _, d := range result.Diagnostics {
			got = append(got, d.String())
			if IsEK(d) && d.Code() == code && d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		key := "rule:" + c.key
		if !found {
			Gap(t, "FuzzFunctionBoundaries", key, "%s; expected EK%04d\n%s\n%v", c.quote, code, c.source, got)
		}
		ExpectPending(t, "FuzzFunctionBoundaries", key)
	})
}

func FuzzFunctionSyntax(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	const quote = "`effect` and the function, name or parameters it modifies are on one line, and an arrow's `=>` is on the line its parameters end"
	if !strings.Contains(string(chapter), quote) {
		f.Fatalf("stale chapter 1 citation: %s", quote)
	}
	cases := []struct {
		key, source string
		allowed     bool
	}{
		{"identifier", "const effect = (n: number) => n; effect(1)", true},
		{"function-positions", "const f: Function = () => 0; const x = f instanceof Function; const p = Function.prototype", true},
		{"property-names", "const o = { arguments: 1, eval: 2, var: 3 }; o.arguments + o.eval + o.var", true},
		{"method-name", "const o = { effect() { return 1 } }; o.effect()", true},
		{"generic-private", "class C { effect #m<T>(x: T) { return x }; static effect m<T>(x: T) { return x } }", true},
		{"bare-arrow", "const f: (x: number) => Effect.Effect<number> = effect x => x", true},
		{"assertion", "const effect: unknown = 1; const x = effect as (number)", true},
		{"newline-function", "const effect = 1; effect\nfunction f() { return 1 }", true},
		{"arrow-newline", "const f = effect (x: number)\n=> x", false},
	}
	w := NewWorkspace(f)
	for i := range cases {
		f.Add(uint8(i))
	}
	f.Fuzz(func(t *testing.T, n uint8) {
		c := cases[int(n)%len(cases)]
		if !c.allowed {
			for _, control := range cases {
				if control.key != "bare-arrow" {
					continue
				}
				result, err := w.Compile(context.Background(), Single("import { Effect } from \"effect\";\n"+control.source+"\nexport {}"))
				if err != nil {
					t.Fatal(err)
				}
				defer result.Remove()
				if HasError(result.Diagnostics) {
					Gap(t, "FuzzFunctionSyntax", "syntax:bare-arrow", "valid arrow control rejected before checking the line break: %v", Keys(result.Dir, result.Diagnostics))
				}
				ExpectPending(t, "FuzzFunctionSyntax", "syntax:bare-arrow")
			}
		}
		source := "import { Effect } from \"effect\";\n" + c.source + "\nexport {}"
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		key := "syntax:" + c.key
		if HasError(result.Diagnostics) == c.allowed {
			Gap(t, "FuzzFunctionSyntax", key, "%s; allowed=%v\n%s\n%v", quote, c.allowed, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, "FuzzFunctionSyntax", key)
	})
}

// These two amendments deliberately delegate errors to TypeScript.
func FuzzFunctionTypeScriptRules(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	const quote = "A recursive function whose type can't be inferred gets TypeScript's own TS7022, TS7023 or TS7024, and no VibeLang diagnostic"
	if !strings.Contains(string(chapter), quote) {
		f.Fatal("stale recursive-inference quote")
	}
	vip, err := vipText(1)
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(vip, "TypeScript's own error only, with no stricter VibeLang check") {
		f.Fatal("stale VIP-1 construction-error citation")
	}
	w := NewWorkspace(f)
	f.Add(false)
	f.Add(true)
	f.Fuzz(func(t *testing.T, recursive bool) {
		source := "effect function f() { return 1 }; new f(); export {}"
		key := "typescript:new"
		if recursive {
			source = "effect function f(n: number) { return n ? try f(n-1) : 0 }; export {}"
			key = "typescript:recursive"
		}
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		for _, d := range result.Diagnostics {
			if IsEK(d) {
				Gap(t, "FuzzFunctionTypeScriptRules", key, "VIP-1 delegates to TypeScript; got %v\n%s", Keys(result.Dir, result.Diagnostics), source)
			}
			if !IsEK(d) && (recursive && (d.Code() == 7022 || d.Code() == 7023 || d.Code() == 7024) || !recursive && (d.Code() == 2350 || d.Code() == 7009)) {
				found = true
			}
		}
		if !found {
			Gap(t, "FuzzFunctionTypeScriptRules", key, "expected TypeScript diagnostic\n%s\n%v", source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, "FuzzFunctionTypeScriptRules", key)
		if recursive {
			control := "import { Effect } from \"effect\"; effect function f(n: number): Effect.Effect<number> { return n ? try f(n-1) : 0 }; export {}"
			typed, err := w.Compile(context.Background(), Single(control))
			if err != nil {
				t.Fatal(err)
			}
			defer typed.Remove()
			if HasError(typed.Diagnostics) {
				Gap(t, "FuzzFunctionTypeScriptRules", "typescript:recursive-annotated", "VIP-1 says writing the return type fixes recursive inference\n%s\n%v", control, Keys(typed.Dir, typed.Diagnostics))
			}
			ExpectPending(t, "FuzzFunctionTypeScriptRules", "typescript:recursive-annotated")
		}
	})
}

// The positive control is essential: an unimplemented effect-function parser
// must not make rejection of a nested restore look like conformance.
func FuzzRestoreFunctionBoundary(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/002-running.md"))
	if err != nil {
		f.Fatal(err)
	}
	const quote = "`restore` is lexical, and the nested Effect, or each item's Effect, runs outside the mask's control"
	if !strings.Contains(string(chapter), quote) {
		f.Fatal("stale restore boundary citation")
	}
	code := chapterCode(f, chapter, quote)
	w := NewWorkspace(f)
	nested := []struct{ key, body string }{
		{"arrow", "const e = effect () => { restore {} }"},
		{"block", "const e = effect { restore {} }"},
		{"function", "effect function g() { restore {} }"},
		{"method", "const o = { effect m() { restore {} } }"},
		{"producer", "effect function* g() { restore {} }"},
		{"concurrent", "for concurrent (const x of [1]) { restore {} }"},
	}
	for i := range nested {
		f.Add(uint8(i))
	}
	f.Fuzz(func(t *testing.T, n uint8) {
		compile := func(source string) *Result {
			r, err := w.Compile(context.Background(), Single(source+"\nexport {}"))
			if err != nil {
				t.Fatal(err)
			}
			return r
		}
		control := compile("effect function f() { uninterruptible { restore {} interruptible { restore {} } } }")
		defer control.Remove()
		if HasError(control.Diagnostics) {
			Gap(t, "FuzzRestoreFunctionBoundary", "feature:mask-control", "valid lexical control rejected: %v", Keys(control.Dir, control.Diagnostics))
		}
		ExpectPending(t, "FuzzRestoreFunctionBoundary", "feature:mask-control")
		c := nested[int(n)%len(nested)]
		key := "rule:" + c.key
		source := "effect function f() { uninterruptible { " + c.body + " } }"
		r := compile(source)
		defer r.Remove()
		found := false
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == code && d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		if !found {
			Gap(t, "FuzzRestoreFunctionBoundary", key, "%s; expected EK%04d\n%s\n%v", quote, code, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, "FuzzRestoreFunctionBoundary", key)
	})
}

// Check type information too: runtime Exit equality alone cannot observe a
// compiler silently dropping an Effect's error or requirement type.
func FuzzFunctionEffectInference(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	const quote = "An inferred type takes its success from what the function returns, a `return` in a parameter default included, and its errors and requirements from the Effects its body runs"
	if !strings.Contains(string(chapter), quote) {
		f.Fatal("stale Effect inference citation")
	}
	w := NewWorkspace(f)
	for _, n := range []uint8{0, 1, 2, 4, 5, 6} {
		f.Add(n)
	}
	f.Fuzz(func(t *testing.T, n uint8) {
		slot := int(n&3) % 3
		mode, annotation := "inferred", ""
		expected := "Effect.Effect<number, \"bad\", S>"
		if n&4 != 0 {
			mode, annotation = "written", ": "+expected
		}
		header := "import { Effect } from \"effect\"; interface S { readonly brand: unique symbol }; declare const input: " + expected + ";\n"
		source := header + "effect function f()" + annotation + " { return try input }\n"
		reference := header + "function f()" + annotation + " { return Effect.gen(function* () { return yield* input }) }\n"
		bad := []string{"Effect.Effect<string, \"bad\", S>", "Effect.Effect<number, never, S>", "Effect.Effect<number, \"bad\", never>"}[slot]
		compile := func(text string, ts bool) *Result {
			filename := "main.vibe"
			if ts {
				filename = "main.ts"
			}
			r, err := w.Compile(context.Background(), Project{Files: map[string]string{filename: text}})
			if err != nil {
				t.Fatal(err)
			}
			return r
		}
		hasAssign := func(r *Result) bool {
			for _, d := range r.Diagnostics {
				if !IsEK(d) && d.Code() == 2322 && d.Category() == diagnostics.CategoryError {
					return true
				}
			}
			return false
		}
		good := "const value: " + expected + " = f();\n"
		wrong := "const value: " + bad + " = f();\n"
		refGood := compile(reference+good, true)
		defer refGood.Remove()
		refBad := compile(reference+wrong, true)
		defer refBad.Remove()
		if HasError(refGood.Diagnostics) || !hasAssign(refBad) {
			t.Fatalf("invalid Effect TypeScript witness: %v / %v", Keys(refGood.Dir, refGood.Diagnostics), Keys(refBad.Dir, refBad.Diagnostics))
		}
		control := compile(source+good, false)
		defer control.Remove()
		key := "feature:" + mode + "-control"
		if HasError(control.Diagnostics) {
			Gap(t, "FuzzFunctionEffectInference", key, "%s\n%s\n%v", quote, source+good, Keys(control.Dir, control.Diagnostics))
		}
		ExpectPending(t, "FuzzFunctionEffectInference", key)
		r := compile(source+wrong, false)
		defer r.Remove()
		key = "type:" + mode + "-" + []string{"success", "error", "requirements"}[slot]
		if !hasAssign(r) {
			Gap(t, "FuzzFunctionEffectInference", key, "the specified Effect.gen rejects this assignment with TS2322\n%s\n%v", source+wrong, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, "FuzzFunctionEffectInference", key)
	})
}
