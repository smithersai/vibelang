package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// Chapter 2: an operand that is not an Iterable is EK1901. Chapter 7: native
// static errors are as in TypeScript, whose for...of over a rejected operand
// gives the element the error type, so a head pattern or a body read of the
// item adds no error. The native loop in a plain function is the control.
func TestConcurrentRejectedOperandItem(t *testing.T) {
	for _, operand := range []struct{ name, typ string }{
		{"unknown", "unknown"},
		{"number", "number"},
		{"optional", "number[][] | undefined"},
		{"object", "{}"},
	} {
		for _, shape := range []struct{ name, head, body string }{
			{"array-pattern", "const [item = 0]", "void item"},
			{"object-pattern", "const { length }", "void length"},
			{"body-destructure", "const item", "const [z] = item; void z"},
			{"body-property", "let item", "void item.length"},
		} {
			t.Run(operand.name+"/"+shape.name, func(t *testing.T) {
				control := fmt.Sprintf("export function check(rows: %s) { for (%s of rows) { %s } }", operand.typ, shape.head, shape.body)
				if errors := errorsOf(t, control); len(errors) != 1 || errors[0].Source() == diagnosticSource {
					t.Fatalf("native control: want one TypeScript error at the operand, got %v\n%s", errors, control)
				}
				source := fmt.Sprintf("export effect function check(rows: %s) { for concurrent (%s of rows) { %s } }", operand.typ, shape.head, shape.body)
				var got []string
				for _, d := range errorsOf(t, source) {
					got = append(got, fmt.Sprintf("%s%d %s", d.Source(), d.Code(), d.String()))
				}
				if len(got) != 1 || !strings.HasPrefix(got[0], "EK1901 ") {
					t.Fatalf("want exactly EK1901, got %v\n%s", got, source)
				}
			})
		}
	}
}
