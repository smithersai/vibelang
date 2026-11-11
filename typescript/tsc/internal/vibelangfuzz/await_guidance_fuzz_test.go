package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var awaitGuidanceQuotes = []struct{ chapter, text string }{
	{"002-running.md", "Returning an Effect does not itself execute it."},
	{"002-running.md", "`await` keeps exactly JavaScript's meaning and belongs to `async` functions and the module top level."},
	{"900-appendices.md", "Promises may be awaited in async code; use `tryPromise` and `try` in effect code."},
	{"900-appendices.md", "| `EK4607` | retired `select` block"},
}

func TestAwaitGuidanceQuoted(t *testing.T) {
	for _, q := range awaitGuidanceQuotes {
		if !strings.Contains(SpecText(q.chapter), q.text) {
			t.Errorf("%s no longer says %q", q.chapter, q.text)
		}
	}
}

const awaitGuidancePrelude = `import { Effect, Fiber, Deferred } from "effect"
declare const program: Effect.Effect<number>
declare const pending: Promise<number>
declare const fiber: Fiber.Fiber<number>
declare const deferred: Deferred.Deferred<number>
`

var awaitGuidanceKeys = []string{"effect-call", "effect-value", "promise", "value", "fiber", "deferred", "handles"}

func checkAwaitGuidance(t *testing.T, w *Workspace, key string, variant byte) {
	t.Helper()
	TestAwaitGuidanceQuoted(t)
	operand, repair, modifier, want := "Effect.succeed(1)", "try Effect.succeed(1)", "effect ", "returns an unrun Effect; await cannot run it."
	code := int32(4601)
	switch key {
	case "effect-value":
		operand, repair, code = "program", "try program", 4603
		want = "Mark the function effect and write try program, or use await runPromise(program) in an async function."
	case "promise":
		operand, repair, modifier, code = "pending", "await pending", "async ", 4602
		want = "Make the function async to await the Promise, or mark it effect and use try tryPromise(() => pending)."
	case "value":
		operand, repair, modifier, code = "1", "1", "", 4603
		want = "Remove await: a value needs no waiting."
	case "fiber":
		operand, repair, code = "fiber", "join fiber", 102
		want = "Mark the function effect and write join fiber, or use await runPromise(Fiber.join(fiber)) in an async function."
	case "deferred":
		operand, repair, code = "deferred", "try Deferred.await(deferred)", 102
		want = "Mark the function effect and write try Deferred.await(deferred), or use await runPromise(Deferred.await(deferred)) in an async function."
	case "handles":
		operand, repair, code = "[fiber, deferred]", "try.all([Fiber.join(fiber), Deferred.await(deferred)])", 4603
		want = "In effect code, join fibers with join and wait for each Deferred with try Deferred.await(deferred)."
	default:
		key = "effect-call"
	}
	sep := []string{" ", "\n", " /* operand */ "}[int(variant)%3]
	if variant&4 != 0 {
		operand = "(" + operand + ")"
	}
	body := "return await" + sep + operand
	fixed := "return " + repair
	wrap := func(modifier, body string) string {
		switch (variant / 8) % 4 {
		case 1:
			return "export const read = " + modifier + "() => { " + body + " }"
		case 3:
			return "export effect function outer() { return " + modifier + "function read() { " + body + " } }"
		case 2:
			return "export const reader = { " + modifier + "read() { " + body + " } }"
		default:
			return "export " + modifier + "function read() { " + body + " }"
		}
	}
	r, err := w.Compile(t.Context(), Single(awaitGuidancePrelude+wrap("", body)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	text, count := "", 0
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == code {
			text += doTemporaryDiagnosticText(d)
			count++
		}
	}
	// Advice retains the written operand, including parentheses.
	switch key {
	case "effect-value":
		want = fmt.Sprintf("Mark the function effect and write try %s, or use await runPromise(%s) in an async function.", operand, operand)
	case "promise":
		want = fmt.Sprintf("Make the function async to await the Promise, or mark it effect and use try tryPromise(() => %s).", operand)
	case "fiber":
		want = fmt.Sprintf("Mark the function effect and write join %s, or use await runPromise(Fiber.join(%s)) in an async function.", operand, operand)
	case "deferred":
		want = fmt.Sprintf("Mark the function effect and write try Deferred.await(%s), or use await runPromise(Deferred.await(%s)) in an async function.", operand, operand)
	}
	// The native parser may reject a plain arrow before the legacy checker.
	// The plain function regression always exercises the compatibility notes.
	nativeErrors := 0
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			nativeErrors++
		}
	}
	nativeArrowError := (variant/8)%4 == 1 && count == 0 && nativeErrors > 0
	if !nativeArrowError && (count != 1 || !strings.Contains(text, want)) {
		Gap(t, "FuzzAwaitGuidance", key, "VIP-1/VIP-5 guidance must preserve cold Effects and native async await: want %q, got %q (%d diagnostics)", want, text, count)
	}
	for _, stale := range []string{"already runs here", "runs and waits", "runs when you call it", "Wrap it in a hatch", "d.await()"} {
		if strings.Contains(text, stale) {
			Gap(t, "FuzzAwaitGuidance", key, "retired advice %q in %s", stale, text)
		}
	}
	repaired, err := w.Compile(t.Context(), Single(awaitGuidancePrelude+wrap(modifier, fixed)))
	if err != nil {
		t.Fatal(err)
	}
	defer repaired.Remove()
	errors := 0
	for _, d := range repaired.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errors++
		}
	}
	if errors != 0 {
		Gap(t, "FuzzAwaitGuidance", key, "suggested repair does not compile: %v", Keys(repaired.Dir, repaired.Diagnostics))
	}
}

func TestAwaitGuidanceRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range awaitGuidanceKeys {
		t.Run(key, func(t *testing.T) { checkAwaitGuidance(t, w, key, 0) })
	}
}

func FuzzAwaitGuidance(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range awaitGuidanceKeys {
		f.Add(key, byte(0))
		f.Add(key, byte(13))
		f.Add(key, byte(18))
		f.Add(key, byte(29))
	}
	f.Fuzz(func(t *testing.T, key string, variant byte) { checkAwaitGuidance(t, w, key, variant) })
}

// Both execution contexts offered by the notes must typecheck.
func TestAwaitGuidanceRepairs(t *testing.T) {
	TestAwaitGuidanceQuoted(t)
	w := NewWorkspace(t)
	source := awaitGuidancePrelude + `
export effect function callEffect() { return try Effect.succeed(1) }
export async function callAsync(): Promise<number> { return await runPromise(Effect.succeed(1)) }
export effect function valueEffect() { return try program }
export async function valueAsync(): Promise<number> { return await runPromise(program) }
export effect function promiseEffect() { return try tryPromise(() => pending) }
export async function promiseAsync(): Promise<number> { return await pending }
export effect function fiberEffect() { return join fiber }
export async function fiberAsync(): Promise<number> { return await runPromise(Fiber.join(fiber)) }
export effect function deferredEffect() { return try Deferred.await(deferred) }
export async function deferredAsync(): Promise<number> { return await runPromise(Deferred.await(deferred)) }
`
	r, err := w.Compile(t.Context(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Error(specDiagnosticText(d))
		}
	}
}
