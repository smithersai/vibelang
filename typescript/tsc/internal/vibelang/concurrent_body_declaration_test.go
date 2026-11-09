package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A for concurrent body is a Statement (VIP-19, Appendix A), as a for...of
// body is: a let, const or using declaration, an interface or a type alias
// that stands as the body is TS1156 at the range TypeScript gives the native
// loop's. The compiler writes a block around the body, which used to hide it.
func TestConcurrentBodyDeclaration(t *testing.T) {
	blockErrors := func(t *testing.T, loop, body string) []string {
		source := "effect function f(xs: number[], rows: Stream.Stream<number>) { " + loop + " " + body + " }"
		p, f, _, _ := editorProgram(t, source)
		at := strings.Index(source, loop) + len(loop) + 1
		var got []string
		syntactic := p.GetSyntacticDiagnostics(t.Context(), f)
		for _, d := range syntactic {
			// The parser's report must not hide the file's semantic errors.
			if !recoverableNativeSyntax(d) {
				t.Errorf("%s %s: syntax error %d is not recoverable", loop, body, d.Code())
			}
		}
		for _, d := range append(syntactic, p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() == 1156 {
				got = append(got, fmt.Sprintf("%d+%d %s", d.Pos()-at, d.Len(), d.String()))
			} else if d.Code() < 2000 {
				// Other grammar errors, such as TS1344 for a label before
				// a declaration, are the native loop's too.
				got = append(got, fmt.Sprintf("TS%d", d.Code()))
			}
		}
		slices.Sort(got)
		return got
	}
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"const", "const y = 1;", 1},
		{"let", "let y = 1;", 1},
		{"using", "using r = { [Symbol.dispose]() {} };", 1},
		{"interface", "interface I { a: number }", 1},
		{"type", "type T = number;", 1},
		{"labeled-const", "a: const y = 1;", 1},
		{"labeled-twice", "a: b: let y = 1;", 1},
		{"labeled-type", "a: type T = number;", 1},
		{"block", "{ const y = 1; }", 0},
		{"labeled-block", "a: { const y = 1; }", 0},
		{"class", "class C {}", 0},
		{"function", "function g() {}", 0},
		{"expression", "xs.length;", 0},
		{"empty", ";", 0},
		{"nested-loop", "for (const z of xs) { const y = z; }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			native := blockErrors(t, "for (const x of xs)", tc.body)
			count := 0
			for _, text := range native {
				if strings.Contains(text, "can only be declared inside a block") {
					count++
				}
			}
			if count != tc.want {
				t.Fatalf("the native loop reports %v, want %d TS1156", native, tc.want)
			}
			for _, loop := range []string{"for concurrent (const x of xs)", "for concurrent(2) (const x of xs)", "for concurrent (let x of xs)", "for try (const x of rows)"} {
				if got := blockErrors(t, loop, tc.body); !slices.Equal(got, native) {
					t.Errorf("%s %s reports %v, the native loop %v", loop, tc.body, got, native)
				}
			}
		})
	}
}
