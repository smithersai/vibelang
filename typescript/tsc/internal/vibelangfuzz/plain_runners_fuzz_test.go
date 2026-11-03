package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// plainRunnersQuote is VIP-1's rule for a function with neither keyword. A
// runner starts a root fiber, which code no fiber runs may do (D38): a plain
// function is such code, so a runner call in it compiles with no diagnostic,
// whatever form the function takes (VIP-1 flip acceptance cases 3-5,
// foldkit-3: Effect.runFork, Effect.runSync and runPromise in plain
// functions).
const plainRunnersQuote = "neither keyword: plain JavaScript"

// plainRunnerForms are the plain function forms FuzzFunctionPlainRunners
// puts a runner call in; RUN stands for the call.
var plainRunnerForms = []struct{ key, source string }{
	{"top-level", "RUN"},
	{"parenthesized-statement", "export function f(): void { ((RUN)) }"},
	{"async", "export async function f(): Promise<void> { RUN }"},
	{"getter", "export class C { get value(): number { RUN; return 1 } }"},
	{"setter", "export class C { set value(_value: number) { RUN } }"},
	{"static-block", "export class C { static { RUN } }"},
	{"parameter-default", "export function f(_value = (RUN, 1)): void {}"},
	{"plain-in-effect", "export effect function f() { const g = () => { RUN }; g() }"},
	{"declaration", "export function f(): void { RUN }"},
	{"arrow", "export const f = (): void => { RUN }"},
	{"expression-arrow", "export const f = () => RUN"},
	{"function-expression", "export const f = function (): void { RUN }"},
	{"method", "export class C { m(): void { RUN } }"},
	{"object-method", "export const o = { m(): void { RUN } }"},
	{"constructor", "export class C { constructor() { RUN } }"},
	{"returned-arrow", "export const f = () => (): void => { RUN }"},
	{"array-callback", "export const f = (xs: ReadonlyArray<number>): void => { xs.forEach(() => { RUN }) }"},
	{"plain-callee-callback", "function each(g: () => void): void { g() }\nexport const f = (): void => { each(() => { RUN }) }"},
}

// plainRunners are Effect's root runners (D38).
var plainRunners = []string{"runSync", "runFork", "runPromise", "runSyncExit", "runPromiseExit", "runCallback"}

// TestPlainRunnersQuoted checks the VIP-1 sentence FuzzFunctionPlainRunners
// cites (specTests in PACKAGE.ts), so a VIP edit that rewords it fails its
// own gate.
func TestPlainRunnersQuoted(t *testing.T) {
	vip, err := vipText(1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(vip, plainRunnersQuote) {
		t.Errorf("VIP-1 no longer says %q; update FuzzFunctionPlainRunners' quote", plainRunnersQuote)
	}
}

// FuzzFunctionPlainRunners compiles one runner call in one plain function
// form. The input is the key form:runner (keyed corpus); other bytes pick
// both by index.
func FuzzFunctionPlainRunners(f *testing.F) {
	startShortBudget(f)
	vip, err := vipText(1)
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(vip, plainRunnersQuote) {
		f.Fatal("stale VIP-1 plain-function citation")
	}
	for _, form := range plainRunnerForms {
		for _, runner := range plainRunners {
			f.Add([]byte(form.key + ":" + runner))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		form, runner := plainRunnerInput(data)
		key := "plain-runner:" + form.key + ":" + runner
		run := "Effect." + runner + "(Effect.succeed(1))"
		source := "import { Effect } from \"effect\"\n" + strings.ReplaceAll(form.source, "RUN", run) + "\n"
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if HasError(result.Diagnostics) {
			Gap(t, "FuzzFunctionPlainRunners", key, "VIP-1: %q, so a runner may start a root fiber there\n%s\n%v", plainRunnersQuote, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, "FuzzFunctionPlainRunners", key)
	})
}

// plainRunnerInput reads form:runner, or picks both from the first two bytes.
func plainRunnerInput(data []byte) (struct{ key, source string }, string) {
	if formKey, runner, ok := strings.Cut(string(data), ":"); ok {
		for _, form := range plainRunnerForms {
			for _, r := range plainRunners {
				if form.key == formKey && r == runner {
					return form, runner
				}
			}
		}
	}
	var a, b byte
	if len(data) > 0 {
		a = data[0]
	}
	if len(data) > 1 {
		b = data[1]
	}
	return plainRunnerForms[int(a)%len(plainRunnerForms)], plainRunners[int(b)%len(plainRunners)]
}
