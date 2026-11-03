package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestTrailingBlockJavaScriptWhitespace(t *testing.T) {
	for _, space := range []string{" ", "\t", "\v", "\f", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u202f", "\u205f", "\u3000", "\ufeff", " \u00a0\t"} {
		for _, head := range []string{"g(1)", "g(1,)", "g<number>(1)", "zero()", "zero"} {
			t.Run(fmt.Sprintf("%U/%s", []rune(space), head), func(t *testing.T) {
				source := "function g<T>(n:T,cb:()=>number){return cb()}; function zero(cb:()=>number){return cb()}; export function probe(){return " + head + space + "{return 2;};}"
				p, file, _, _ := editorProgram(t, source)
				p = trailingBlockMigrationProgram(p)
				file = p.GetSourceFile(file.FileName())
				p.GetSemanticDiagnostics(t.Context(), file)
				c, done := p.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				calls := trailingBlockCalls(file)
				if len(calls) != 1 {
					t.Fatalf("got %d trailing blocks", len(calls))
				}
				rewrite := trailingBlockRewrite(c, file, calls[0])
				if !rewrite.fixable() {
					t.Fatalf("no repair: %+v", rewrite)
				}
				fixed := applyEdits(source, rewrite.edits)
				if fixed == source || !strings.Contains(fixed, "() => {return 2;}") {
					t.Fatalf("missing repair: %s", fixed)
				}
				if errors := errorsOf(t, fixed); len(errors) != 0 {
					t.Fatalf("fixed source: %v\n%s", errors, fixed)
				}
			})
		}
	}
}
