package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// Ruling 2026-11-04 (proxy, on alchemy's 05:38Z EK4802 question): EK4802
// catches an Effect silently used as a plain value. A generic call that is the
// direct operand of try, through parentheses, is consumed by try, which runs
// the inferred Effect at once, so EK4802 stays silent. The same call assigned,
// passed, returned or pushed without try still warns. The exemption is
// consumption by try, not the callee's name: pipe is not special.
// Alchemy RC6 (drive-alchemy 05:12Z, 229 sites in 173 files) reported
// `return try Stream.make(1, 2).pipe(Stream.runCollect)`.
func TestEffectIntoPlainGenericRunCall(t *testing.T) {
	const decls = "function take<T>(x: T): T { return x }\n" +
		"function wrap<T>(x: T): { readonly value: T } { return { value: x } }\n" +
		"function apply<A, B>(a: A, f: (a: A) => B): B { return f(a) }\n" +
		"function sink(x: unknown): number { return 1 }\n" +
		"const box = { pipe<B>(f: () => B): B { return f() } }\n"
	for _, test := range []struct {
		name, body string
		want       int
	}{
		{"run-stream-pipe", "return try Stream.make(1, 2).pipe(Stream.runCollect)", 0},
		{"run-identity", "return try take(job)", 0},
		{"run-identity-parens", "return try (take(job))", 0},
		{"run-identity-double-parens", "const n = try ((take(job))); return n", 0},
		{"run-callback-result", "return try apply(1, () => job)", 0},
		{"run-callback-wrapper", "return (try apply(1, () => Effect.succeed(1))) + 0", 0},
		{"run-other-arg", "return try apply(job, (a) => a)", 0},
		{"assigned-identity", "const value = take(job); return 1", 1},
		{"assigned-named-pipe", "const value = box.pipe(() => job); return 1", 1},
		{"passed-identity", "return sink(take(job))", 1},
		{"returned-identity", "return take(job)", 1},
		{"pushed-identity", "const xs: unknown[] = []; xs.push(take(job)); return 1", 1},
		{"assigned-callback-result", "const value = apply(1, () => job); return 1", 1},
		{"run-wrapper-argument", "return try Effect.succeed(wrap(job))", 1},
		{"run-nested-operand-argument", "return try take(take(job))", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := decls + "export effect function probe(job: Effect.Effect<number>) { " + test.body + " }\n"
			program, file, _, _ := editorProgram(t, source)
			count := 0
			var where []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4802.Code && strings.Contains(d.MessageText(), "infers an Effect in a plain function's generic parameter") {
					count++
					where = append(where, fmt.Sprint(d.Pos()))
				}
			}
			if count != test.want {
				t.Fatalf("got %d EK4802 at %v, want %d\n%s", count, where, test.want, source)
			}
		})
	}
}
