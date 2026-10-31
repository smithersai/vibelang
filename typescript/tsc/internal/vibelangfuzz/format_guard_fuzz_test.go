package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// FuzzFormatGuard checks the formatter's own guard, vibelangfmt.SameProgram,
// which refuses a result that does not parse to the source's program, against
// rewrites that keep the program: Chapter 7 says "formatting preserves parsed
// program meaning", so the guard must accept every layout the TypeScript
// formatter may write, or a valid file cannot format. The rewrites are the
// two dprint writes around statements: an empty statement before a
// statement, as its "asi" setting writes `;(x)` (an empty statement does
// nothing: ECMAScript, EmptyStatement), and braces around a body of one
// statement, as its useBraces settings write. The input is a .vibe source
// and a mask: bit i of the mask picks the i-th statement or body to rewrite.
// The two rewrites must compose: dprint wrote `if (c) {\n  ;(try effect { …
// }) catch …\n}` in alchemy's packages/hetzner, and the guard read a block of
// two statements against one (corpus alchemy-if-asi-statement).
func FuzzFormatGuard(f *testing.F) {
	startShortBudget(f)
	formatGuardChapter(f)
	seen := map[string]bool{}
	for _, seed := range toolsSample(CaseSeeds(), 200, 0, nil) {
		for _, name := range toolsVibeFiles(seed.Files) {
			if text := seed.Files[name]; !seen[text] {
				seen[text] = true
				f.Add(text, []byte{0xff, 0xff, 0xff, 0xff})
			}
		}
	}
	f.Fuzz(func(t *testing.T, source string, mask []byte) {
		if len(source) > 24<<10 || toolsSyntaxError("main.vibe", source) != "" {
			return
		}
		rewritten := formatGuardRewrite(source, mask)
		if rewritten == source {
			return
		}
		if toolsSyntaxError("main.vibe", rewritten) != "" {
			// The guard need not accept what does not parse.
			return
		}
		g := &Gaps{Target: "FuzzFormatGuard", Input: source}
		key := ""
		if name := corpusFile(t, "FuzzFormatGuard"); name != "" {
			key = "corpus:" + name
			g.Input = "testdata/fuzz/FuzzFormatGuard/" + name
		}
		if err := vibelangfmt.SameProgram(source, rewritten); err != nil {
			g.Add("guard:"+formatGuardKey(err), "Chapter 7: %q; the guard refuses a rewrite that keeps the program (%v):\n%s\nrewritten:\n%s", formatGuardQuote, err, source, rewritten)
		}
		g.FinishInput(t, key)
	})
}

// TestFormatGuardQuoted fails when Chapter 7 rewords the sentence the oracle
// quotes (RULES.md 9).
func TestFormatGuardQuoted(t *testing.T) { formatGuardChapter(t) }

const formatGuardQuote = "formatting preserves parsed program meaning"

func formatGuardChapter(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), formatGuardQuote) {
		tb.Fatalf("Chapter 7 no longer says %q", formatGuardQuote)
	}
}

// formatGuardKey names a refusal by what changed, without its position.
func formatGuardKey(err error) string {
	_, change, ok := strings.Cut(err.Error(), ": ")
	if !ok {
		change = err.Error()
	}
	return toolsSlug(change)
}

// formatGuardRewrite inserts an empty statement before each picked statement
// of a statement list that starts with a parenthesis, a bracket or a
// template, and braces around each picked body of one statement
// that has none.
func formatGuardRewrite(source string, mask []byte) string {
	file := toolsParse("main.vibe", source)
	type insertion struct {
		pos  int
		text string
	}
	var edits []insertion
	index := 0
	picked := func() bool {
		i := index
		index++
		return i/8 < len(mask) && mask[i/8]&(1<<(i%8)) != 0
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindBlock, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause, ast.KindSourceFile:
			for _, statement := range formatGuardStatements(node) {
				// Where dprint writes it: right before a statement that
				// starts with a parenthesis, a bracket or a template.
				start := scanner.SkipTrivia(source, statement.Pos())
				if start < len(source) && strings.ContainsRune("([`", rune(source[start])) && picked() {
					edits = append(edits, insertion{start, ";"})
				}
			}
		case ast.KindIfStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement, ast.KindWhileStatement:
			// Only a statement the source writes: a typed catch clause,
			// catch (e: Busy), parses into an if of its own over e.
			keyword := map[ast.Kind]string{ast.KindIfStatement: "if", ast.KindWhileStatement: "while"}[node.Kind]
			if keyword == "" {
				keyword = "for"
			}
			if node.Flags&ast.NodeFlagsReparsed != 0 || !strings.HasPrefix(source[scanner.SkipTrivia(source, node.Pos()):], keyword) {
				break
			}
			for _, body := range formatGuardBodies(node) {
				if body.Kind != ast.KindBlock && body.Kind != ast.KindEmptyStatement && !ast.IsDeclarationStatement(body) && body.Kind != ast.KindVariableStatement && picked() {
					edits = append(edits, insertion{scanner.SkipTrivia(source, body.Pos()), "{ "}, insertion{body.End(), " }"})
				}
			}
		}
		node.ForEachChild(visit)
		return false
	}
	visit(file.AsNode())
	slices.SortStableFunc(edits, func(a, b insertion) int { return b.pos - a.pos })
	out := source
	for _, e := range edits {
		out = out[:e.pos] + e.text + out[e.pos:]
	}
	return out
}

func formatGuardStatements(node *ast.Node) []*ast.Node {
	switch node.Kind {
	case ast.KindSourceFile:
		return node.AsSourceFile().Statements.Nodes
	case ast.KindBlock:
		return node.AsBlock().Statements.Nodes
	case ast.KindModuleBlock:
		return node.AsModuleBlock().Statements.Nodes
	default:
		return node.AsCaseOrDefaultClause().Statements.Nodes
	}
}

func formatGuardBodies(node *ast.Node) []*ast.Node {
	if node.Kind == ast.KindIfStatement {
		s := node.AsIfStatement()
		if s.ElseStatement != nil && s.ElseStatement.Kind != ast.KindIfStatement {
			return []*ast.Node{s.ThenStatement, s.ElseStatement}
		}
		return []*ast.Node{s.ThenStatement}
	}
	return []*ast.Node{node.Statement()}
}
