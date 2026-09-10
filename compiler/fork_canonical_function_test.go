package compiler

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPinnedForkCanonicalFunction(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	canonicalizer := backend.(FunctionCanonicalizer)
	for _, tc := range []struct{ name, source, invocation string }{
		{"declaration", `function work(value: number): number { return value + 1; }`, "fn(41)"},
		{"export declaration", `export function work(value: number): number { return value + 1; }`, "fn(41)"},
		{"default declaration", `export default function work(value: number): number { return value + 1; }`, "fn(41)"},
		{"anonymous default", `export default function(value: number): number { return value + 1; }`, "fn(41)"},
		{"anonymous expression", `function(value: number): number { return value + 1; }`, "fn(41)"},
		{"parenthesized expression", `(function work(value: number): number { return value + 1; })`, "fn(41)"},
		{"arrow", `(value: number): number => value + 1`, "fn(41)"},
		{"generic arrow", `<T>(value: T): T => value`, "fn(42)"},
		{"async declaration", `export async function work(value: number): Promise<number> { return value + 1; }`, "fn(41)"},
		{"async arrow", `async (value: number) => value + 1`, "fn(41)"},
		{"generator", `export function* work(): Generator<number> { yield 42; }`, "fn().next().value"},
		{"async generator", `export async function* work(): AsyncGenerator<number> { yield 42; }`, "fn().next().then(item => item.value)"},
		{"default parameter", `function work(value: number = 42) { return value }`, "fn()"},
		{"closure retained as a reference", `function work() { return captured }`, "fn()"},
		{"comments", `/** ignored documentation */ export /* ignored export trivia */ function work(value: number) { /* ignored body trivia */ return value + 1 }`, "fn(41)"},
		{"Unicode", `export function 計算(入力: number): number { return 入力 + 1 }`, "fn(41)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := canonicalizer.CanonicalFunction(ctx, CanonicalFunctionRequest{Source: tc.source})
			if err != nil || !got.OK || got.Message != "" || got.Code == "" || strings.Contains(got.Code, "ignored") {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			node, err := exec.LookPath("node")
			if err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, node, "--input-type=module")
			command.Stdin = strings.NewReader("const captured = 42; const fn = " + got.Code + "; Promise.resolve(" + tc.invocation + ").then(value => console.log(value));")
			output, err := command.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != "42" {
				t.Fatalf("output=%q err=%v\n%s", output, err, got.Code)
			}
		})
	}
	t.Run("modifiers and erased annotations do not change the fingerprint", func(t *testing.T) {
		var expected string
		for _, source := range []string{
			`function work(value) { return value + 1; }`,
			`export function work(value: number): number { return value + 1; }`,
			`export default function work(value: number): number { return value + 1; }`,
		} {
			got, err := canonicalizer.CanonicalFunction(ctx, CanonicalFunctionRequest{Source: source})
			if err != nil || !got.OK {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if expected != "" && got.Code != expected {
				t.Fatalf("fingerprints differ:\n%s\n%s", expected, got.Code)
			}
			expected = got.Code
		}
	})
	t.Run("locates the function after compiler-generated helpers", func(t *testing.T) {
		got, err := canonicalizer.CanonicalFunction(ctx, CanonicalFunctionRequest{Source: `function work(resource: Disposable) { using local = resource; return 42; }`})
		if err != nil || !got.OK || !strings.Contains(got.Code, "function work(resource)") || !strings.Contains(got.Code, "return 42") || strings.Contains(got.Code, "function (env, value, async)") {
			t.Fatalf("helper was fingerprinted in place of the function: %+v err=%v", got, err)
		}
	})
	for _, source := range []string{
		"", "42", "value", "class Value {}", "({ work() {} })", "declare function work(): void;",
		"export const work = () => 42;", "function work( {", "() => ;", "function work() {}; work();",
		"(() => 42)()", "function work(){}); globalThis.sideEffect = 1; const other = (()=>42",
	} {
		t.Run("refuses "+source, func(t *testing.T) {
			got, err := canonicalizer.CanonicalFunction(ctx, CanonicalFunctionRequest{Source: source})
			if err != nil || got.OK || got.Code != "" || got.Message == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	t.Run("source budget", func(t *testing.T) {
		if got, err := canonicalizer.CanonicalFunction(ctx, CanonicalFunctionRequest{Source: strings.Repeat(" ", 2*1024*1024+1)}); err == nil {
			t.Fatalf("source budget was not enforced: %+v", got)
		}
	})
}
