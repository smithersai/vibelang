package parser_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The match lookahead reads a subject that the parse reads again. Without
// its verdict kept for each position, every level of nested match( doubles
// the work: 24 levels took over 25 s. The test compares the allocations of
// two shallow depths first, so a regression fails here and does not hang at
// the depth the issue names.
func TestVibeLangNestedMatchCallsParseInLinearTime(t *testing.T) {
	for _, row := range []struct{ name, open, innermost, close string }{
		{"calls", "match(%d, ", "0", ")"},
		{"calls-with-regexp", "match(%d, ", "/\\)/.test(`${1})`)", ")"},
		{"matches", "match (", "1", ") { when let v: v; }"},
		{"async-matches", "async match (", "1", ") { when let v: v; }"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := func(depth int) string {
				var text strings.Builder
				text.WriteString("declare function match(...a: unknown[]): number\nexport const v = ")
				for i := range depth {
					text.WriteString(strings.ReplaceAll(row.open, "%d", strconv.Itoa(i)))
				}
				text.WriteString(row.innermost)
				text.WriteString(strings.Repeat(row.close, depth))
				return text.String()
			}
			parse := func(depth int) *ast.SourceFile {
				return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source(depth), core.ScriptKindTS)
			}
			// Eight more levels cost 256 times the work when each level doubles
			// it. With the verdicts kept, the subject at depth d is read d+1
			// times, so the cost is quadratic: about 4 times.
			shallow := testing.AllocsPerRun(3, func() { parse(8) })
			deep := testing.AllocsPerRun(3, func() { parse(16) })
			if deep > 16*shallow {
				t.Fatalf("16 nested forms allocate %.0f times, 8 allocate %.0f: each level multiplies the work", deep, shallow)
			}
			if diagnostics := parse(40).Diagnostics(); len(diagnostics) != 0 {
				t.Fatalf("syntax diagnostics %v:\n%s", diagnostics, source(40))
			}
		})
	}
}
