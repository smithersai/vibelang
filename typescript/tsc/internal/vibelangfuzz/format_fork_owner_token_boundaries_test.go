package vibelangfuzz

import "testing"

func TestFormatForkOwnerTokenBoundariesQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", `| [+Effect] "fork" "." "in" "(" AssignmentExpression ")" ForkOperand`)
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

func formatForkOwnerTokenBoundarySources() []string {
	var sources []string
	for _, scope := range []string{"scope", "owner()", "(scope)"} {
		for _, operand := range []string{"value", "work()", "1", "0x1", "true", "null", "this.value", "new Task()", "typeof value", "\\u0061", "café", "$task"} {
			sources = append(sources, "effect function f() { return fork.in("+scope+")"+operand+" }")
		}
	}
	return sources
}
