package vibelang

import (
	"context"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { ls.RegisterCodeFixProvider(dataVariantTagPatternFix) }

// VIP-7: a data variant's class pattern becomes the tag object pattern. A bare
// variant, when Delivery.Sent, becomes when { _tag: "Sent" }; a variant with a
// field list, when Delivery.Sent { let tracking }, becomes
// when { _tag: "Sent", let tracking }, keeping the field patterns and their
// trivia. An extractor's argument list after a variant was never valid, and a
// variant read through a value that may run a getter, registry.State.Waiting,
// has no fix: both need a hand.
var dataVariantTagPatternFix = &ls.CodeFixProvider{
	Source: diagnosticSource, ErrorCodes: []int32{EK0702.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		file, text := fix.SourceFile, fix.SourceFile.Text()
		seen := map[core.TextRange]bool{}
		var actions []*ls.CodeAction
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if !isPatternCall(node, "$is") {
				return node.ForEachChild(visit)
			}
			matcher := node.Arguments()[0]
			start := nodeStart(file, matcher)
			if start != fix.Span.Pos() || matcher.End() != fix.Span.End() || seen[matcher.Loc] {
				return node.ForEachChild(visit)
			}
			seen[matcher.Loc] = true
			tag, _, ok := dataVariantOf(c, matcher)
			if !ok || !namespaceReceiver(c, matcher.Expression()) || ordinaryExtractorSpan(file, matcher).End() != matcher.End() {
				return false
			}
			end, replacement := matcher.End(), "{ _tag: "+strconv.Quote(tag)
			if after := scanner.SkipTrivia(text, end); after < len(text) && text[after] == '{' {
				// The field list's own brace opens the tag object pattern.
				end, replacement = after+1, replacement+","
			} else {
				replacement += " }"
			}
			actions = append(actions, &ls.CodeAction{
				Description: "Write the tag object pattern, { _tag: " + strconv.Quote(tag) + " }",
				Changes:     []*lsproto.TextEdit{{Range: fix.LS.RangeOf(file, core.NewTextRange(start, end)), NewText: replacement}},
			})
			return false
		}
		file.AsNode().ForEachChild(visit)
		return actions, nil
	},
}

// namespaceReceiver reports whether expr, the value a variant constructor is
// read from, is a name, or names read through module and namespace objects
// only: Delivery, Shapes.Shape or N.D. Dropping such a read changes nothing
// observable; a property of any other value, registry.State, may run a getter.
func namespaceReceiver(c *checker.Checker, expr *ast.Node) bool {
	for ast.IsPropertyAccessExpression(expr) {
		expr = expr.Expression()
		symbol := c.GetSymbolAtLocation(expr)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol == nil || symbol.Flags()&ast.SymbolFlagsModule == 0 {
			return false
		}
	}
	return ast.IsIdentifier(expr)
}
