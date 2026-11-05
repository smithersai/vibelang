package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestForTryOperandKeepsNativeIterationErrors(t *testing.T) {
	rows := []struct {
		key, body string
		native    int32
	}{
		{"for-of", "for(const n of INPUT){void n}", 2488},
		{"binding", "const [n]=INPUT;void n", 2488},
		{"spread", "const values=[...INPUT];void values", 2488},
		{"generator", "function* read(){yield* INPUT};void read", 2488},
		{"for-await", "const read=async()=>{for await(const n of INPUT){void n}};void read", 2504},
		{"async-generator", "async function* read(){yield* INPUT};void read", 2504},
	}
	for _, row := range rows {
		for context := 0; context < 4; context++ {
			for variant := 0; variant < 3; variant++ {
				name := row.key + "/" + string(rune('0'+context)) + "/" + string(rune('0'+variant))
				t.Run(name, func(t *testing.T) {
					inner := "1"
					if variant == 2 {
						inner = "[1]"
					}
					result := "Stream.make(1)"
					if context&1 != 0 {
						result = "1"
					}
					operand := "(()=>{" + strings.ReplaceAll(row.body, "INPUT", inner) + ";return " + result + "})()"
					if variant == 1 {
						operand = "(/* operand */ " + operand + ")"
					}
					kind := "effect "
					if context&2 != 0 {
						kind = ""
					}
					source := "export " + kind + "function run(){for try(const value of " + operand + "){void value}}"
					program, file, _, _ := editorProgram(t, source)
					var got []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							got = append(got, d.Code())
						}
					}
					var want []int32
					if context&2 != 0 {
						want = append(want, 2001)
					}
					if context&1 != 0 {
						want = append(want, 2004)
					}
					if variant != 2 {
						want = append(want, row.native)
					}
					slices.Sort(got)
					slices.Sort(want)
					if !slices.Equal(got, want) {
						t.Fatalf("want %v got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
