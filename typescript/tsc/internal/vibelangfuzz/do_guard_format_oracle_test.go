package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7 permits empty statements before written expression statements;
// a compiler capture of a return operand is not a written statement.
func TestFormatGuardDoSourceStatements(t *testing.T) {
	formatGuardChapter(t)
	for _, op := range []string{"&&", "||", "??"} {
		for _, operand := range []string{"(x)", "(x && do { x })", "(x ?? do { undefined })"} {
			source := "export function main(x: string | undefined) { return " + operand + " " + op + " do { x } }"
			rewritten := formatGuardRewrite(source, []byte{0xff, 0xff, 0xff, 0xff})
			if strings.Contains(rewritten, "return ;") {
				t.Fatalf("inserted a statement into a return operand:\n%s", rewritten)
			}
			if err := vibelangfmt.SameProgram(source, rewritten); err != nil {
				t.Fatalf("source-only layout mutation changed meaning: %v\n%s", err, rewritten)
			}
		}
	}
}
