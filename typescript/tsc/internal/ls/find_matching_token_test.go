package ls

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// findPrecedingMatchingToken's text fast path looks only before the close
// token, as TypeScript's does (lastIndexOf from the token's start). Searching
// the whole file matched the `)` of `g(a)` with the unclosed `(` after it, so
// getPossibleTypeArgumentsInfo walked from that `(` back to the same `)` again
// and completion never returned.
func TestFindPrecedingMatchingTokenLooksBeforeTheToken(t *testing.T) {
	text := "const v = (o: Array<number>) => g(a)\n  g(\n    o,\n    x"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, text, core.ScriptKindTS)
	closeParen := strings.Index(text, "a)") + 1
	token := astnav.FindPrecedingToken(file, closeParen+1)
	if token == nil || token.Kind != ast.KindCloseParenToken {
		t.Fatalf("setup: got %v, want the ) of g(a)", token)
	}
	match := findPrecedingMatchingToken(token, ast.KindOpenParenToken, file)
	if match == nil || match.End() > token.Pos() {
		t.Fatalf("matched %v, which does not precede the ) at %d", match, token.Pos())
	}
	if got, want := match.Pos(), strings.Index(text, "g(a)")+1; got != want {
		t.Errorf("matched the ( at %d, want the ( of g(a) at %d", got, want)
	}
}
