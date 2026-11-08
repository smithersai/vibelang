package vibelang

import (
	"strings"
	"testing"
)

// fiberNameErrors counts the EK1702 reports of source.
func fiberNameErrors(t *testing.T, source string) int {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range file.Diagnostics() {
		if d.Code() == reservedFiberName.Code {
			count++
		}
	}
	return count
}

// Appendix A: under [+Effect] fork and join cannot name a variable, parameter,
// label or shorthand property; a member and plain code keep the ordinary name.
func TestReservedFiberNames(t *testing.T) {
	for _, word := range []string{"fork", "join"} {
		for _, test := range []struct {
			name, source string
			want         int
		}{
			{"local", `export effect function f() { const W = 1; return W }`, 1},
			{"let", `export effect function f() { let W = 1; return W + 0 }`, 1},
			{"parameter", `export effect function f(W: number) { return 1 }`, 1},
			{"effect arrow parameter", `export const f = effect (W: number) => 1`, 1},
			{"bare effect arrow parameter", `export const f = effect W => 1`, 1},
			{"plain arrow head in effect code", `export effect function f() { return (W: number) => 1 }`, 1},
			{"bare plain arrow head in effect code", `export effect function f() { return [1].map(W => 1) }`, 1},
			{"async arrow head in effect code", `export effect function f() { return async (W: number) => 1 }`, 1},
			{"destructuring", `export effect function f(o: { W: number }) { const { W } = o; return 1 }`, 1},
			{"array destructuring", `export effect function f(o: number[]) { const [W] = o; return 1 }`, 1},
			{"for-of", `export effect function f() { const g = () => 1; for (const W of [1]) { g() } return 1 }`, 1},
			{"label", `export effect function f() { W: for (;;) { break W } return 1 }`, 1},
			{"nested function name", `export effect function f() { function W() { return 1 } return 1 }`, 1},
			{"nested class name", `export effect function f() { class W { } return 1 }`, 1},
			{"plain expression name in effect code", `export effect function f() { return function W() { return 1 } }`, 0},
			{"renamed destructuring", `export effect function f(o: { W: number }) { const { W: v } = o; return v }`, 0},
			{"is pattern", "export effect function f(p: unknown) { return p is W }", 1},
			{"negated pattern", "export effect function f(p: unknown) { return p is not W.C }", 1},
			{"match pattern", "export effect function f(p: unknown) { return match (p) { when W: 1; default: 0; } }", 1},
			{"relational pattern", "export effect function f(p: unknown) { return p is instanceof W.C }", 1},
			{"signed pattern", "export effect function f(p: unknown) { return p is -W }", 1},
			{"signed relational pattern", "export effect function f(p: unknown) { return p is < -W }", 1},
			{"plain pattern", "export function f(p: unknown) { return p is W }", 0},
			{"pattern member name", "export effect function f(p: unknown, o: { W: number }) { return p is o.W }", 0},
			{"nested plain pattern", "export effect function f(p: unknown) { return () => p is W }", 0},
			{"new callee", `export effect function f() { return new W }`, 1},
			{"new call", `export effect function f() { return new W(1) }`, 1},
			{"new member", `export effect function f() { return new W.C }`, 1},
			{"new computed member", `export effect function f() { return new W[0] }`, 1},
			{"new non-null", `export effect function f() { return new W!.C }`, 1},
			{"heritage", `export effect function f() { return class extends W {} }`, 1},
			{"heritage member", `export effect function f() { return class extends W.C {} }`, 1},
			{"effect arrow new", `export const f = effect () => new W.C`, 1},
			{"producer new", `export effect function* f() { yield new W.C }`, 1},
			{"effect parameter new", `export effect function f(x = new W.C) { return x }`, 1},
			{"ordinary constructor", `export function f() { return new W.C }`, 0},
			{"ordinary heritage", `export function f() { return class extends W.C {} }`, 0},
			{"nested ordinary constructor", `export effect function f() { return () => new W.C }`, 0},
			{"field constructor", `export effect function f() { return class { x = new W.C } }`, 0},
			{"constructor member name", `export effect function f() { return new C.W }`, 0},
			{"member read", `export effect function f(o: { W: number }) { return o.W }`, 0},
			{"object key", `export effect function f() { return { W: 1 } }`, 0},
			{"plain local", `export function f() { const W = 1; return W }`, 0},
			{"plain parameter", `export function f(W: number) { return W }`, 0},
			{"plain function in effect code", `export effect function f() { const g = () => { const W = 1; return W }; return g() }`, 0},
			{"nested function head resets", `export effect function f() { function h(W: number) { return W } return h(1) }`, 0},
			{"field initializer resets", `export effect function f() { class C { v = ((W: number) => W)(1) } return new C().v }`, 0},
			{"top-level declaration", `export function W(n: number) { return n }`, 0},
			{"effect declaration name", `export effect function W() { return 1 }`, 0},
			{"effect shorthand declaration name", `export effect W() { return 1 }`, 0},
		} {
			t.Run(word+"/"+test.name, func(t *testing.T) {
				if got := fiberNameErrors(t, strings.ReplaceAll(test.source, "W", word)); got != test.want {
					t.Fatalf("EK1702 reports: %d, want %d, in %s", got, test.want, test.source)
				}
			})
		}
	}
}

// A pattern's reference does not authorize changing a valid outer class's name.
func TestFiberPatternFixPreservesOuterClass(t *testing.T) {
	for _, word := range []string{"fork", "join"} {
		source := "class " + word + " {}\nexport effect function f(p: unknown) { return p is " + word + " }\n"
		program, file, _, _ := editorProgram(t, source)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		renamed := fiberNameRenames(c, file)
		done()
		if len(renamed) != 1 || len(renamed[0].edits) != 0 || !strings.Contains(renamed[0].why, "outer callable") {
			t.Fatalf("unsafe outer rename: %+v", renamed)
		}
	}
}
