package vibelang

import (
	"strings"
	"testing"
)

func TestCallableOwnNameContext(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         int
	}{
		{"expression-join", "const f = effect function join() { return 1 }", 1},
		{"expression-fork", "const f = effect function fork() { return 1 }", 1},
		{"producer-expression", "const f = effect function* fork() { yield 1 }", 1},
		{"parenthesized-expression", "const f = (effect function join() { return 1 })", 1},
		{"escaped-expression", "const f = effect function j\\u006fin() { return 1 }", 1},
		{"unicode-expression", "const café = '😀'; const f = effect function join() { return 1 }", 1},
		{"nested-declaration", "effect function outer() { effect function join() { return 1 }; return 0 }", 1},
		{"nested-plain-declaration", "effect function outer() { function fork() { return 1 }; return 0 }", 1},
		{"nested-producer-declaration", "effect function outer() { effect function* fork() { yield 1 }; return 0 }", 1},
		{"nested-overload", "effect function outer() { effect function join(x: number): number!!; effect function join(x: number) { return x }; return 0 }", 2},
		{"effect-block-declaration", "const value = effect { function join() { return 1 }; return 0 }", 1},
		{"do-declaration", "effect function outer() { const value = do { function join() { return 1 }; 0 }; return 0 }", 1},
		{"arrow-head-inherits", "effect function outer() { const inner = (x = do { function join() { return 1 }; 0 }) => 0; return 0 }", 1},
		{"async-arrow-head-inherits", "effect function outer() { const inner = async (x = do { function fork() { return 1 }; 0 }) => 0; return 0 }", 1},
		{"do-plain-boundary", "effect function outer() { function inner() { const value = do { function join() { return 1 }; 0 } }; return 0 }", 0},
		{"expression-ordinary-name", "const f = effect function ordinary() { return 1 }", 0},
		{"declaration", "export effect function fork() { return 1 }", 0},
		{"producer-declaration", "export effect function* join() { yield 1 }", 0},
		{"overload", "effect function fork(x: number): number!!; effect function fork(x: number) { return x }", 0},
		{"default-declaration", "export default effect function join() { return 1 }", 0},
		{"object-method", "const value = { effect join() { return 1 } }", 0},
		{"class-method", "class Value { effect fork() { return 1 } }", 0},
		{"object-producer", "const value = { effect *fork() { yield 1 } }", 0},
		{"class-producer", "class Value { effect *join() { yield 1 } }", 0},
		{"plain-function-boundary", "effect function outer() { function inner() { effect function fork() { return 1 } }; return 0 }", 0},
		{"async-function-boundary", "effect function outer() { async function inner() { effect function join() { return 1 } }; return 0 }", 0},
		{"plain-arrow-boundary", "effect function outer() { const inner = () => { effect function fork() { return 1 } }; return 0 }", 0},
		{"async-arrow-boundary", "effect function outer() { const inner = async () => { effect function fork() { return 1 } }; return 0 }", 0},
		{"plain-expression-boundary", "effect function outer() { const inner = function join() { return 1 }; return 0 }", 0},
		{"async-expression-boundary", "effect function outer() { const inner = async function fork() { return 1 }; return 0 }", 0},
		{"field-initializer-boundary", "effect function outer() { class Value { field = do { function join() { return 1 }; 0 } }; return 0 }", 0},
		{"static-block-inherits", "effect function outer() { class Value { static { function join() { return 1 } } }; return 0 }", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.source)
			syntax := p.GetSyntacticDiagnostics(t.Context(), file)
			for _, d := range syntax {
				if d.Code() != 1702 {
					t.Fatalf("invalid test syntax: %v", d)
				}
			}
			got := 0
			for _, d := range append(syntax, p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() != 1702 {
					continue
				}
				got++
				text := file.Text()[d.Pos():d.End()]
				if text != "fork" && text != "join" && !strings.Contains(text, "\\u") {
					t.Fatalf("wrong reserved name span: %q", text)
				}
			}
			if got != test.want {
				t.Fatalf("got %d EK1702, want %d: %s", got, test.want, test.source)
			}
		})
	}
}
