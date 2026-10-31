package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Each quote is read from chapter 2 or VIP-5 at test time. A valid control must
// compile before a forbidden form can prove that the compiler rejects it.
var runningRules = []struct{ key, quote, good, bad string }{
	{"try-plain", "`try` outside effect code", "function f() { return 1 }", "function f() { return try Effect.succeed(1) }"},
	{"try-number", "`try e` where `e` is not an Effect.", "effect function f() { return try Effect.succeed(1) }", "effect function f() { return try 1 }"},
	{"try-statement", "a `try` statement", "effect function f() { return 1 }", "effect function f() { try { return 1 } catch { return 2 } }"},
	{"try-finally", "a `try` statement", "effect function f() { return 1 }", "effect function f() { try { return 1 } finally { } }"},
	{"catch-plain", "`catch` outside effect code", "function f() { return 1 }", "function f() { return Effect.fail(1) catch (() => 2) }"},
	{"try-catch", "`try x catch h`: write `try x` or `x catch h`, never both", "effect function f() { return Effect.fail(1) catch (() => 2) }", "effect function f() { return try Effect.fail(1) catch (() => 2) }"},
	{"catch-number", "`e catch h` where `e` is not an Effect", "effect function f() { return Effect.fail(1) catch (() => 2) }", "effect function f() { return 1 catch (() => 2) }"},
	{"catch-nullish", "without them it is a syntax error", "effect function f() { return (Effect.fail(1) catch (() => 2)) ?? 3 }", "effect function f() { return Effect.fail(1) catch (() => 2) ?? 3 }"},
	{"catch-or", "without them it is a syntax error", "effect function f() { return (Effect.fail(1) catch (() => 2)) || 3 }", "effect function f() { return Effect.fail(1) catch (() => 2) || 3 }"},
	{"catch-and", "without them it is a syntax error", "effect function f() { return (Effect.fail(1) catch (() => 2)) && 3 }", "effect function f() { return Effect.fail(1) catch (() => 2) && 3 }"},
	{"all-object", "an operand that is not an array of Effects", "effect function f() { return try.all [Effect.succeed(1)] }", "effect function f() { return try.all { a: Effect.succeed(1) } }"},
	{"concurrent-break", "`break` that would leave head binding initialization or the body: `for concurrent (const x of xs) { break }`", "effect function f() { for concurrent (const x of [1]) { continue } }", "effect function f() { for concurrent (const x of [1]) { break } }"},
	{"concurrent-return", "`return` targeting the enclosing function in head binding initialization or the body: `for concurrent (const x of xs) { return x }`", "effect function f() { for concurrent (const x of [1]) { continue } }", "effect function f() { for concurrent (const x of [1]) { return } }"},
	{"concurrent-continue-outer", "a labeled `continue` in head binding initialization or the body naming a statement that encloses the `for concurrent`", "effect function f() { for concurrent (const x of [1]) { continue } }", "effect function f() { outer: for (const n of [1]) { for concurrent (const x of [1]) { continue outer } } }"},
	{"stream-return", "`return` targeting the enclosing function in head binding initialization or the body: `for try (const x of s) { return x }`", "effect function f() { for try (const x of Stream.fromIterable([1])) { break } }", "effect function f() { for try (const x of Stream.fromIterable([1])) { return } }"},
	{"producer-return-value", "`return value` in a producer", "effect function* f() { yield 1; return }", "effect function* f() { yield 1; return 2 }"},
	{"restore-outside", "`restore { }` outside an `uninterruptible` block", "effect function f() { uninterruptible { restore { } } }", "effect function f() { restore { } }"},
	{"try-promise", "`try e` where `e` is not an Effect.", "effect function f() { return try Effect.succeed(1) }", "effect function f() { return try Promise.resolve(1) }"},
	{"concurrent-plain", "`for concurrent` outside effect code", "effect function f() { for concurrent (const x of [1]) { } }", "function f() { for concurrent (const x of [1]) { } }"},
	{"stream-plain", "`for try` outside effect code", "effect function f() { for try (const x of Stream.fromIterable([1])) { } }", "function f() { for try (const x of Stream.fromIterable([1])) { } }"},
	{"stream-head-return", "`return` targeting the enclosing function in head binding initialization or the body: `for try (const x of s) { return x }`", "effect function f() { const rows: { n?: number }[] = [{}]; for try (const { n = (() => { return 7 })() } of Stream.fromIterable(rows)) { } }", "effect function f() { const rows: { n?: number }[] = [{}]; for try (const { n = do { return } } of Stream.fromIterable(rows)) { } }"},
	{"stream-head-computed-return", "`return` targeting the enclosing function in head binding initialization or the body: `for try (const x of s) { return x }`", "effect function f() { const rows: { n?: number }[] = [{}]; for try (const { [do { \"n\" as const }]: n } of Stream.fromIterable(rows)) { } }", "effect function f() { const rows: { n?: number }[] = [{}]; for try (const { [do { return }]: n } of Stream.fromIterable(rows)) { } }"},
	{"stream-head-break-outer", "a labeled `break` or `continue` in head binding initialization or the body naming a statement that encloses the `for try`", "effect function f() { const rows: { n?: number }[] = [{}]; outer: for (const m of [1]) { for try (const { n = do { 7 } } of Stream.fromIterable(rows)) { }; break outer } }", "effect function f() { const rows: { n?: number }[] = [{}]; outer: for (const m of [1]) { for try (const { n = do { break outer } } of Stream.fromIterable(rows)) { } } }"},
	{"stream-head-continue-outer", "a labeled `break` or `continue` in head binding initialization or the body naming a statement that encloses the `for try`", "effect function f() { const rows: { n?: number }[] = [{}]; outer: for (const m of [1]) { for try (const { n = do { 7 } } of Stream.fromIterable(rows)) { }; continue outer } }", "effect function f() { const rows: { n?: number }[] = [{}]; outer: for (const m of [1]) { for try (const { n = do { continue outer } } of Stream.fromIterable(rows)) { } } }"},
	{"mask-plain", "`uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code", "effect function f() { uninterruptible { } }", "function f() { uninterruptible { } }"},
	{"interruptible-plain", "`uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code", "effect function f() { interruptible { } }", "function f() { interruptible { } }"},
	{"restore-plain", "`uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code", "effect function f() { uninterruptible { restore { } } }", "function f() { restore { } }"},
	{"fork-plain", "`fork` or `join` outside effect code", "effect function f() { const f = fork Effect.succeed(1) }", "function f() { const f = fork Effect.succeed(1) }"},
	{"join-plain", "`fork` or `join` outside effect code", "effect function f() { const f = fork Effect.succeed(1); return join f }", "function f(f: any) { return join f }"},
	{"race-object", "an operand that is not an array of Effects", "effect function f() { return try.race [Effect.succeed(1)] }", "effect function f() { return try.race { a: Effect.succeed(1) } }"},
	{"any-object", "an operand that is not an array of Effects", "effect function f() { return try.any [Effect.succeed(1)] }", "effect function f() { return try.any { a: Effect.succeed(1) } }"},
	{"allSettled-object", "an operand that is not an array of Effects", "effect function f() { return try.allSettled [Effect.succeed(1)] }", "effect function f() { return try.allSettled { a: Effect.succeed(1) } }"},
	{"catch-parameter", "the parameter's type annotation is allowed and checked as for a TypeScript arrow parameter", "effect function f() { return Effect.fail(1) catch (e: number) => e + 1 }", "effect function f() { return Effect.fail(1) catch (e: string) => e.length }"},
	{"catch-async-arrow", "an `async`, generator or `async` generator handler", "effect function f() { return Effect.fail(1) catch () => 7 }", "effect function f() { return Effect.fail(1) catch async () => 7 }"},
	{"catch-async-function", "an `async`, generator or `async` generator handler", "effect function f() { return Effect.fail(1) catch function () { return 7 } }", "effect function f() { return Effect.fail(1) catch async function () { return 7 } }"},
	{"catch-generator-function", "an `async`, generator or `async` generator handler", "effect function f() { return Effect.fail(1) catch function () { return 7 } }", "effect function f() { return Effect.fail(1) catch function* () { return 7 } }"},
	{"catch-async-generator-function", "an `async`, generator or `async` generator handler", "effect function f() { return Effect.fail(1) catch function () { return 7 } }", "effect function f() { return Effect.fail(1) catch async function* () { return 7 } }"},
	{"nested-plain", "`try` outside effect code", "effect function f() { const g = () => 1; return g() }", "effect function f() { const g = () => try Effect.succeed(1); return g() }"},
	{"contextual-conversion", "A function literal never becomes an Effect", "function take(e: Effect.Effect<number>) { return e }; const out = take(Effect.succeed(1))", "function take(e: Effect.Effect<number>) { return e }; const out = take(() => 1)"},
	{"class-field", "`try` outside effect code", "effect function f() { class C { value = 1 }; return new C().value }", "effect function f() { class C { value = try Effect.succeed(1) }; return new C().value }"},
	{"class-static", "`try` outside effect code", "effect function f() { class C { static { const n = 1 } }; return 1 }", "effect function f() { class C { static { try Effect.succeed(1) } }; return 1 }"},
	{"producer-nested-yield", "In an `effect` function, effect arrow or `effect` block that is not itself a producer, it is `EK2104`, whether or not an outer producer exists.", "effect function* p() { yield 1 }", "effect function* p() { const task = effect { yield 1 }; try task }"},
	{"catch-bare-value", "Anything else after `catch` is a syntax error", "effect function f() { return Effect.fail(1) catch () => 7 }", "effect function f() { return Effect.fail(1) catch 7 }"},
	{"catch-bare-name", "Anything else after `catch` is a syntax error", "const onErr = () => 7; effect function f() { return Effect.fail(1) catch (e) => onErr() }", "const onErr = () => 7; effect function f() { return Effect.fail(1) catch onErr }"},
	{"catch-bare-call", "Anything else after `catch` is a syntax error", "function make() { return 7 }; effect function f() { return Effect.fail(1) catch () => make() }", "function make() { return 7 }; effect function f() { return Effect.fail(1) catch make() }"},
	{"catch-effect-block", "Anything else after `catch` is a syntax error", "effect function f() { return Effect.fail(1) catch effect () => { return 7 } }", "effect function f() { return Effect.fail(1) catch effect { return 7 } }"},
	{"catch-class", "Anything else after `catch` is a syntax error", "effect function f() { return Effect.fail(1) catch () => class C {} }", "effect function f() { return Effect.fail(1) catch class C {} }"},
	{"mask-name-newline", "contextual keywords followed by `{` on the same line", "function f(): number { const uninterruptible = 1, interruptible = 2, restore = 3; uninterruptible\n{ const x = 1 }; interruptible\n{ const x = 2 }; restore\n{ const x = 3 }; return uninterruptible + interruptible + restore }", "function f() { uninterruptible { } }"},
	{"mask-qualified", "Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`", "effect function f() { return try Effect.uninterruptible(Effect.succeed(1)) }", "effect function f() { return try uninterruptible(Effect.succeed(1)) }"},
	{"interruptible-qualified", "Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`", "effect function f() { return try Effect.interruptible(Effect.succeed(1)) }", "effect function f() { return try interruptible(Effect.succeed(1)) }"},
	{"try-newline-statement", "a `try` statement", "effect function f() { return 1 }", "effect function f() { try\n{ return 1 } finally { } }"},
	{"producer-arrow-yield", "`yield` in a nested `effect` block, an arrow or an `effect function` handler is a syntax error", "effect function* p() { yield 1 }", "effect function* p() { const task = effect () => { yield 1 }; try task() }"},
	{"fork-scoped-requirement", "adds `Scope` to R", "import type { Fiber, Scope } from \"effect\"; effect function f(): Effect.Effect<Fiber.Fiber<number>, never, Scope.Scope> { return fork.scoped Effect.succeed(1) }", "import type { Fiber } from \"effect\"; effect function f(): Effect.Effect<Fiber.Fiber<number>, never, never> { return fork.scoped Effect.succeed(1) }"},
	{"concurrent-expression-body", "`for concurrent (const x of xs) (try f(x));` has no limit", "effect function f() { let n = 0; for concurrent (const x of [1, 2]) (try Effect.sync(() => { n += x })); return n }", "effect function f() { for concurrent(1)(2)(const x of [1]) { } }"},
	{"restore-plain-boundary", "`uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code", "function f() { return 1 }", "function f() { uninterruptible { restore { } } }"},
	// foldkit-15: an Effect argument whose success is a function stays that Effect; its function is not called as a thunk.
	{"effect-argument-function-success", "Calls retain ordinary JavaScript evaluation", "import type { Scope } from \"effect\"; const takes = (e: (() => number)!!): number => 1; effect function f(): number!never!Scope.Scope { const detach = try Effect.acquireRelease(Effect.sync((): (() => number) => (): number => 1), (release) => Effect.sync(release)); return detach() + takes(Effect.sync((): (() => number) => (): number => 1)) }", "const takes = (e: (() => number)!!): number => 1; effect function f() { return takes(Effect.sync((): number => 1)) }"},
}

func runningRulesChapter(f testing.TB) string {
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), "EK2111") {
		f.Fatal("chapter 2 no longer assigns EK2111 to restore")
	}
	handlerRules, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips/0005-try-runs-effects.md"))
	if err != nil {
		f.Fatal(err)
	}
	for _, rule := range runningRules {
		rulesText := string(chapter)
		if rule.key == "catch-parameter" {
			rulesText = string(handlerRules)
		}
		if !strings.Contains(rulesText, rule.quote) {
			f.Fatalf("%s: chapter 2 / VIP-5 no longer says %q", rule.key, rule.quote)
		}
	}
	return string(chapter)
}

func TestRunningRulesQuoted(t *testing.T) { runningRulesChapter(t) }

func FuzzRunningRules(f *testing.F) {
	startShortBudget(f)
	chapter := runningRulesChapter(f)
	for _, rule := range runningRules {
		f.Add([]byte(rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		if len(data) != 0 {
			choice = int(data[0]) % len(runningRules)
		}
		for i, rule := range runningRules {
			if string(data) == rule.key {
				choice = i
				break
			}
		}
		rule := runningRules[choice]
		var compileErrors []string
		var errorCodes map[int32]bool
		compile := func(source string) bool {
			compileErrors = nil
			errorCodes = map[int32]bool{}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": "import { Effect, Stream } from \"effect\";\n" + source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					compileErrors = append(compileErrors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
					if IsEK(d) {
						errorCodes[d.Code()] = true
					}
				}
			}
			return len(compileErrors) == 0
		}
		if !compile(rule.good) {
			Gap(t, "FuzzRunningRules", "control:"+rule.key, "chapter 2: %s; valid control does not compile:\n%s\n%s", rule.quote, rule.good, strings.Join(compileErrors, "\n"))
			return
		}
		if compile(rule.bad) {
			Gap(t, "FuzzRunningRules", "reject:"+rule.key, "chapter 2: %s; forbidden form compiled:\n%s", rule.quote, rule.bad)
			return
		}
		if expected := runningRuleDiagnostic(chapter, rule.key, rule.quote); expected != 0 && !errorCodes[expected] {
			Gap(t, "FuzzRunningRules", "diagnostic:"+rule.key, "chapter 2 requires EK%04d for %s; got:\n%s", expected, rule.key, strings.Join(compileErrors, "\n"))
			return
		}
		ExpectPending(t, "FuzzRunningRules", "control:"+rule.key)
		ExpectPending(t, "FuzzRunningRules", "reject:"+rule.key)
		ExpectPending(t, "FuzzRunningRules", "diagnostic:"+rule.key)
		ExpectPending(t, "FuzzRunningRules", specCorpusKey(t))
	})
}

// runningRuleDiagnostic reads the assigned code from the cited table row.
// The two loop chapters share the phrase "return in the body"; restrict the
// stream selector to its own chapter section instead of borrowing a code.
func runningRuleDiagnostic(chapter, key, quote string) int32 {
	if strings.HasPrefix(key, "stream-") {
		_, chapter, _ = strings.Cut(chapter, "## `for try`")
		chapter, _, _ = strings.Cut(chapter, "## Producers")
	}
	pattern := regexp.MustCompile("EK([0-9]{4})")
	for _, line := range strings.Split(chapter, "\n") {
		if !strings.HasPrefix(line, "|") || !strings.Contains(line, quote) {
			continue
		}
		if match := pattern.FindStringSubmatch(line); match != nil {
			code, _ := strconv.Atoi(match[1])
			return int32(code)
		}
	}
	return 0
}
