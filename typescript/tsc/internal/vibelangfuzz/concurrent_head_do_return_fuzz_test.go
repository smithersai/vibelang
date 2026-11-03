package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentHeadDoReturnQuote = "Limit and iterable/Stream operand evaluation remain in the enclosing activation before item work; a `return` in a `do` there keeps its ordinary enclosing target."

func TestConcurrentHeadDoReturnQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentHeadDoReturnQuote)
}

// A do in a for concurrent limit or operand runs in the enclosing function,
// so its return leaves that function (VIP-19) instead of drawing EK0204 at a
// generated function boundary. The item region keeps its own restrictions,
// covered by FuzzConcurrentReturnSites; the runtime order and results are in
// the concurrent-head-do-return case and the vip19.limit-return and
// vip19.rhs-return differential probes.
func FuzzConcurrentHeadDoReturn(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", concurrentHeadDoReturnQuote)
	// want is "" for a program that must compile, or the one error code it
	// must report: the do proposal's head early errors still apply.
	variants := []struct{ key, source, want string }{
		{"limit", "effect function f(early: boolean) { for concurrent(do { if (early) { return 7 }; 1 }) (const x of [1]) {}; return 0 }", ""},
		{"operand", "effect function f(early: boolean) { for concurrent (const x of do { if (early) { return 7 }; [1] }) {}; return 0 }", ""},
		{"limit-and-operand", "effect function f(early: boolean) { for concurrent(do { if (early) { return 7 }; 2 }) (const x of do { if (!early) { return 8 }; [1] }) {}; return 0 }", ""},
		{"operand-after-limit-call", "const seen: string[] = []; effect function f(early: boolean) { for concurrent((seen.push(\"limit\"), 1)) (const x of do { if (early) { return 7 }; [1] }) {}; return 0 }", ""},
		{"limit-before-operand-call", "const seen: string[] = []; effect function f(early: boolean) { for concurrent(do { if (early) { return 7 }; 1 }) (const x of (seen.push(\"rhs\"), [1])) {}; return 0 }", ""},
		{"nested-do", "effect function f(early: boolean) { for concurrent (const x of do { const xs = do { if (early) { return 7 }; [1] }; xs }) {}; return 0 }", ""},
		{"pattern-head", "effect function f(early: boolean) { for concurrent (const [x] of do { if (early) { return 7 }; [[1]] }) {}; return 0 }", ""},
		{"let-head", "effect function f(early: boolean) { for concurrent (let x of do { if (early) { return 7 }; [1] }) { x += 1 }; return 0 }", ""},
		{"try-in-operand", "effect function g() { return [1] }; effect function f(early: boolean) { for concurrent (const x of do { if (early) { return 7 }; try g() }) {}; return 0 }", ""},
		{"try-in-limit", "effect function g() { return 1 }; effect function f(early: boolean) { for concurrent(do { if (early) { return 7 }; try g() }) (const x of [1]) {}; return 0 }", ""},
		{"string-return", "effect function f(early: boolean) { for concurrent(2) (const x of do { if (early) { return \"early\" }; [1] }) {}; return \"done\" }", ""},
		{"outer-continue", "effect function f() { let n = 0; outer: for (const k of [1, 2]) { for concurrent (const x of do { if (k === 1) { continue outer }; [k] }) { n += x } }; return n }", ""},
		{"outer-break-limit", "effect function f() { outer: for (const k of [1, 2]) { for concurrent(do { if (k === 2) { break outer }; 1 }) (const x of [k]) { } }; return 0 }", ""},
		{"reject:operand-break", "effect function f() { for (const k of [1]) { for concurrent (const x of do { if (k === 1) { break }; [k] }) { } }; return 0 }", "EK0205"},
		{"reject:limit-continue", "effect function f() { for (const k of [1]) { for concurrent(do { if (k === 1) { continue }; 1 }) (const x of [k]) { } }; return 0 }", "EK0205"},
		{"reject:own-label-continue", "effect function f() { own: for concurrent (const x of do { if (Math.random() > 2) { continue own }; [1] }) { }; return 0 }", "EK0205"},
		{"labeled-loop", "effect function f(early: boolean) { items: for concurrent (const x of do { if (early) { return 7 }; [1] }) { if (x > 1) { continue } }; return 0 }", ""},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte(v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, _ := keyedChoice(keys, data)
		v := variants[i]
		r, err := w.Compile(context.Background(), Single(v.source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				code := fmt.Sprintf("TS%d", d.Code())
				if IsEK(d) {
					code = fmt.Sprintf("EK%04d", d.Code())
				}
				codes = append(codes, code)
			}
		}
		if v.want == "" && len(codes) != 0 || v.want != "" && !slices.Equal(codes, []string{v.want}) {
			Gap(t, "FuzzConcurrentHeadDoReturn", v.key, "%s; want %q, got %v\n%s", concurrentHeadDoReturnQuote, v.want, Keys(r.Dir, r.Diagnostics), v.source)
		}
	})
}
