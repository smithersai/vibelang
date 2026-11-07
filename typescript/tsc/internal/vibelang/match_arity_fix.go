package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK0703.Code},
		GetCodeActions: extractorArityActions,
	})
	// These alternatives change which subjects match. They are explicit editor
	// choices, never additions to tsFormFixCodes or the --fix migration list.
}

func extractorArityActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	file := fix.SourceFile
	var actions []*ls.CodeAction
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsVariableDeclaration(node) || node.Name() == nil || !ast.IsIdentifier(node.Name()) ||
			node.Name().Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(node.Name().Text(), "$extracted") || node.Initializer() == nil {
			return node.ForEachChild(visit)
		}
		call := extractionCall(c, node.Initializer())
		if call == nil {
			return node.ForEachChild(visit)
		}
		matcher := call.Arguments()[0]
		if nodeStart(file, matcher) != fix.Span.Pos() || matcher.End() != fix.Span.End() {
			return node.ForEachChild(visit)
		}
		known, ok := extractedLength(c, matcher)
		operator, listed, found := extractedLengthTest(node)
		if !ok || !found || !(operator == ast.KindEqualsEqualsEqualsToken && listed != known ||
			operator == ast.KindGreaterThanEqualsToken && listed > known) {
			return false
		}
		span := ordinaryExtractorSpan(file, matcher)
		if span.End() == matcher.End() || extractorRepairDropsReferences(c, file, span) {
			return false
		}
		// Retain all argument-list trivia, including comments, while replacing
		// its pattern tokens. Strings containing comment-like text stay tokens.
		s := scanner.NewScanner()
		text := file.Text()
		s.SetText(text)
		s.ResetPos(matcher.End())
		if s.Scan() != ast.KindOpenParenToken {
			return false
		}
		open, previous := s.TokenStart(), s.TokenEnd()
		var trivia strings.Builder
		for s.TokenEnd() < span.End() {
			if s.Scan() == ast.KindEndOfFile {
				return false
			}
			trivia.WriteString(text[previous:s.TokenStart()])
			previous = s.TokenEnd()
		}
		name := text[nodeStart(file, matcher):matcher.End()]
		actions = append(actions, &ls.CodeAction{
			Description: "Test " + name + " without extracting values",
			Changes:     replaceRange(fix, open, span.End(), trivia.String()),
		})
		if known == 1 {
			binding := (&freshNames{file: file}).freshName("e")
			actions = append(actions, &ls.CodeAction{
				Description: "Extract one value from " + name,
				Changes:     replaceRange(fix, open, span.End(), "(let "+binding+")"+trivia.String()),
			})
		}
		return true
	}
	file.AsNode().ForEachChild(visit)
	return actions, nil
}

// A replacement must not leave a guard or arm body referring to a capture
// whose declaration it removes. Compare symbols so unrelated names do not
// hide an otherwise available action.
func extractorRepairDropsReferences(c *checker.Checker, file *ast.SourceFile, span core.TextRange) bool {
	captures := map[*ast.Symbol]bool{}
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && ast.IsDeclarationName(node) &&
			nodeStart(file, node) >= span.Pos() && node.End() <= span.End() {
			if symbol := c.GetSymbolAtLocation(node); symbol != nil {
				captures[symbol] = true
			}
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	var references func(*ast.Node) bool
	references = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && !ast.IsDeclarationName(node) &&
			(nodeStart(file, node) < span.Pos() || node.End() > span.End()) &&
			captures[c.GetSymbolAtLocation(node)] {
			return true
		}
		return node.ForEachChild(references)
	}
	return file.AsNode().ForEachChild(references)
}
