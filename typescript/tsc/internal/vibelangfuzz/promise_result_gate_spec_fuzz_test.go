package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const promiseGateQuote = "`EK0404` uses the Promise test of [Result tests](002-running.md#result-tests): `never`, `any` and `unknown` never trigger it; any union with at least one `PromiseLike` member does."
const promiseGateFormsQuote = "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |"

const promiseDataBridgeQuote = "Within the Effect, a successful `try` gives the immediate success value unchanged: it neither recursively runs an inner Effect nor assimilates a Promise or thenable stored in that value."

func promiseResultGateCases() []*failCase {
	var cases []*failCase
	for _, result := range []struct{ key, decl, expression string }{
		{"dynamic-import", "", `import("effect")`},
		{"async-match", "", "async match (true) { default: 1; }"},
		{"constructor", "", "new Promise<number>((resolve) => resolve(1))"},
		{"optional-call", "const read: (() => Promise<number>) | undefined = undefined as (() => Promise<number>) | undefined", "read?.()"},
		{"structural", "function read(): PromiseLike<number> { return Promise.resolve(1) }", "read()"},
		{"union-scalar", "function read(): number | Promise<number> { return 1 }", "read()"},
		{"union-null", "function read(): null | PromiseLike<number> { return null }", "read()"},
		{"generic", "function read<T extends PromiseLike<number>>(p: T): T { return p }\ndeclare const p: Promise<number>", "read(p)"},
		{"tag", "export async function read(_parts: TemplateStringsArray) { return 1 }", "read`one`"},
		{"overloaded-tag", "function read(p: TemplateStringsArray): Promise<number>;\nfunction read(p: number): number;\nfunction read(p: TemplateStringsArray | number): Promise<number> | number { return typeof p === \"number\" ? p : Promise.resolve(1) }", "read`one`"},
	} {
		cases = append(cases, &failCase{Name: "promise-gate-" + result.key, Chapter: failuresChapter, Quote: promiseGateFormsQuote, VIP: 4, Owner: "conf-auto-promise-result-call-gate", Decls: result.decl, Body: "const held = ⟦" + result.expression + "⟧", Code: 404})
	}
	for _, kind := range []string{"any", "unknown", "never", "{ then: number }"} {
		key := strings.NewReplacer("{ then: number }", "noncallable-then").Replace(kind)
		cases = append(cases, &failCase{Name: "promise-gate-excluded-" + key, Chapter: failuresChapter, Quote: promiseGateQuote, VIP: 4, Owner: "conf-auto-promise-result-call-gate", Decls: "export declare function read(): " + kind, Body: "const held = read()"})
	}
	cases = append(cases, &failCase{Name: "promise-gate-effect-success-data", Chapter: failuresChapter, Quote: promiseGateFormsQuote, VIP: 4, Owner: "conf-auto-promise-result-call-gate", Decls: "declare const p: Promise<number>", Body: "const held = try Effect.succeed(p)"})
	for _, data := range []struct{ key, declaration, expression string }{
		{"resolve", "", "Promise.resolve(7)"},
		{"constructor", "", "new Promise<number>((resolve) => resolve(7))"},
		{"thenable", "function read(): PromiseLike<number> { return Promise.resolve(7) }", "read()"},
	} {
		cases = append(cases, &failCase{Name: "promise-gate-sync-data-" + data.key, Chapter: "002-running.md", Quote: promiseDataBridgeQuote, VIP: 4, Owner: "compiler", Decls: data.declaration, Body: "const held = try Effect.orDie(Effect.try({ try: () => " + data.expression + ", catch: (e) => e }))"})
	}
	return cases
}

func TestPromiseDataBridgeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), promiseDataBridgeQuote) {
		t.Fatalf("chapter 2 no longer quotes %q", promiseDataBridgeQuote)
	}
}

func TestPromiseDataBridgeForms(t *testing.T) {
	TestPromiseDataBridgeQuoted(t)
	w := NewWorkspace(t)
	seen := 0
	for _, c := range promiseResultGateCases() {
		if !strings.HasPrefix(c.Name, "promise-gate-sync-data-") {
			continue
		}
		seen++
		for _, variation := range []byte{0, 1, 6} {
			t.Run(fmt.Sprintf("%s/%d", c.Name, variation), func(t *testing.T) {
				checkPromiseResultGate(t, w, c, variation)
			})
		}
	}
	if seen != 3 {
		t.Fatalf("expected three synchronous bridge forms, got %d", seen)
	}
}

func TestPromiseResultGateQuoted(t *testing.T) {
	chapter := SpecText(failuresChapter)
	for _, q := range []string{promiseGateQuote, promiseGateFormsQuote} {
		if !strings.Contains(chapter, q) {
			t.Fatalf("%s no longer quotes %q", failuresChapter, q)
		}
	}
}

func FuzzPromiseResultGate(f *testing.F) {
	startShortBudget(f)
	cases := promiseResultGateCases()
	for _, c := range cases {
		f.Add(c.Name, uint8(0))
		f.Add(c.Name, uint8(49))
		f.Add(c.Name, uint8(6))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variation uint8) {
		TestPromiseResultGateQuoted(t)
		TestPromiseDataBridgeQuoted(t)
		i := slices.IndexFunc(cases, func(c *failCase) bool { return c.Name == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		c := *cases[i]
		// All four declaration/statement placements generated by failuresProject
		// have the same Result test. Vary retaining versus discarding the value.
		if variation&16 != 0 {
			c.Body = strings.Replace(c.Body, "const held = ", "void ", 1)
		}
		if variation&32 != 0 {
			c.Body = strings.Replace(c.Body, "⟦", "⟦(/* result */ ", 1)
			c.Body = strings.Replace(c.Body, "⟧", ")⟧", 1)
		}
		t.Run(fmt.Sprint(variation), func(t *testing.T) { checkPromiseResultGate(t, w, &c, variation&15) })
	})
}

func checkPromiseResultGate(t *testing.T, w *Workspace, c *failCase, choice byte) {
	t.Helper()
	files, span := failuresProject(c, choice)
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	matched := 0
	var unexpected []string
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if c.rejects() && IsEK(d) && d.Code() == 404 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") && d.Pos() <= span[1] && d.End() >= span[0] {
			matched++
		} else {
			unexpected = append(unexpected, describe(d))
		}
	}
	want := 0
	if c.rejects() {
		want = 1
	}
	if matched != want || len(unexpected) > 0 {
		Gap(t, "FuzzPromiseResultGate", "feature:"+c.Name, "%s (VIP-4): %q; got %d marked EK0404, want %d; unexpected %v\n%s", failuresChapter, c.Quote, matched, want, unexpected, Archive(files))
	}
	ExpectPending(t, "FuzzPromiseResultGate", "feature:"+c.Name)
	ExpectPending(t, "FuzzPromiseResultGate", specCorpusKey(t))
}
