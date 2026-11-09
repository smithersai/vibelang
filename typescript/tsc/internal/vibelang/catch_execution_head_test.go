package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCatchExecutionIndependentDiagnostics(t *testing.T) {
	source := `declare const p: number!!;
function take(n: number) { return Effect.succeed(n) }
export effect function main() {
 try take("bad") catch () => 0;
 try p satisfies string catch () => 0;
 try do { const n: number = "bad"; Effect.succeed(n) } catch () => 0;
 return 0
}`
	program, file, _, _ := editorProgram(t, source)
	codes := map[int32]bool{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		codes[d.Code()] = true
	}
	for _, code := range []int32{505, 2345, 1360, 2322} {
		if !codes[code] {
			t.Errorf("lost independent diagnostic %d: %v", code, codes)
		}
	}
}

// TestCatchExecutionForkDiagnosticPrecedence checks the checker, not just the
// parser's source-head search: fork produces a Fiber, but an unparenthesized
// execution head must report EK0505 before the Effect operand test.
func TestCatchExecutionForkDiagnosticPrecedence(t *testing.T) {
	for _, test := range []struct {
		head string
		want int32
	}{
		{"fork p", 505},
		{"fork p as Fiber.Fiber<number, string>", 505},
		{"(fork p)", 506},
	} {
		t.Run(test.head, func(t *testing.T) {
			source := "declare const p: Effect.Effect<number, string>; export effect function main() { " + test.head + " catch () => 0; return 0 }"
			program, file, _, _ := editorProgram(t, source)
			counts := map[int32]int{}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource {
					counts[d.Code()]++
				}
			}
			if counts[test.want] != 1 || counts[505]+counts[506] != 1 {
				t.Fatalf("head %q: expected only EK%04d among catch-head diagnostics, got %v", test.head, test.want, counts)
			}
		})
	}
}

// VIP-5 checks source execution heads before their scalar/Fiber result types.
// Pair every erased wrapper with a real source-parentheses barrier.
func TestCatchExecutionScalarWrapperPrecedence(t *testing.T) {
	for _, head := range []struct{ expression, result string }{
		{"try p", "number"},
		{"fork p", "Fiber.Fiber<number, string>"},
		{"join fiber", "number"},
		{"try.all [p]", "number[]"},
	} {
		for _, wrap := range []string{"direct", "as", "assertion", "satisfies", "nonnull"} {
			for _, grouped := range []bool{false, true} {
				expression := head.expression
				want := int32(505)
				if grouped {
					expression = "(" + expression + ")"
					want = 506
				}
				switch wrap {
				case "as":
					expression += " as " + head.result
				case "assertion":
					expression = "<" + head.result + ">" + expression
				case "satisfies":
					expression += " satisfies " + head.result
				case "nonnull":
					expression += "!"
				}
				t.Run(expression, func(t *testing.T) {
					source := "declare const p: Effect.Effect<number, string>; declare const fiber: Fiber.Fiber<number, string>; export effect function main(){ " + expression + " catch () => 0; return 0 }"
					program, file, _, _ := editorProgram(t, source)
					counts := map[int32]int{}
					var messages []string
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							counts[d.Code()]++
							messages = append(messages, d.String())
						}
					}
					if counts[want] != 1 || counts[505]+counts[506] != 1 || len(counts) != 1 {
						t.Fatalf("expected only EK%04d, got %v\n%s", want, counts, strings.Join(messages, "\n"))
					}
				})
			}
		}
	}
}
