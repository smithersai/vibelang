package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"slices"
	"strings"
)

const declarationBodyLabel = "declaration syntax"
const declarationBodyKey = "declaration-body:"

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1503.Code, EK1604.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1503.Code, EK1604.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK1503.Code, EK1604.Code},
		GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			edits := declarationBodyEditsFor(fix.SourceFile, nil, &fix.Span)
			if len(edits) == 0 {
				return nil, nil
			}
			first, last := edits[0], edits[len(edits)-1]
			if fix.Span.Pos() < first.start || (fix.Span.Pos() > last.end && fix.Span.Pos() != scanner.SkipTrivia(fix.SourceFile.Text(), last.end)) {
				return nil, nil
			}
			var changes []*lsproto.TextEdit
			for _, edit := range edits {
				changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
			}
			if len(changes) == 0 {
				return nil, nil
			}
			return []*ls.CodeAction{{Description: "Preserve the expression or write the empty schema body", Changes: changes}}, nil
		},
	})
}

// Repair only the assigned missing-body diagnostics, for declarations affected by the
// adopted contextual-keyword rule; other missing-token errors are untouched.
func declarationBodyEdits(file *ast.SourceFile) []sourceEdit {
	return declarationBodyEditsFor(file, nil, nil)
}

func declarationBodyEditsFor(file *ast.SourceFile, codes []int32, at *core.TextRange) []sourceEdit {
	if !isVibeLangFile(file) {
		return nil
	}
	var selected []*ast.Diagnostic
	for _, d := range file.Diagnostics() {
		if d.Source() != diagnosticSource || (d.Code() != EK1503.Code && d.Code() != EK1604.Code) {
			continue
		}
		if len(codes) > 0 && !slices.Contains(codes, d.Code()) {
			continue
		}
		if at != nil && (d.Pos() != at.Pos() || d.End() != at.End()) {
			continue
		}
		selected = append(selected, d)
	}
	if len(selected) == 0 {
		return nil
	}
	accepts := func(start, end int) bool {
		for _, d := range selected {
			if d.Pos() >= start && d.End() <= end {
				return true
			}
		}
		return false
	}
	text := file.Text()
	ts := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/declaration-repair.ts", PathKey: "/declaration-repair.ts"}, text, core.ScriptKindTS)
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsExpressionStatement(node) {
			expression := node.Expression()
			if (expression.Kind == ast.KindAsExpression || expression.Kind == ast.KindSatisfiesExpression) && !ast.NodeIsMissing(expression.Type()) {
				operand := expression.Expression()
				if ast.IsIdentifier(operand) && (operand.Text() == "schema" || operand.Text() == "data") {
					start := nodeStart(ts, expression)
					if !accepts(start, expression.End()) {
						return false
					}
					edits = []sourceEdit{{start, start, "("}, {expression.End(), expression.End(), ")"}}
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	ts.AsNode().ForEachChild(visit)
	if len(edits) > 0 {
		return edits
	}
	visit = func(node *ast.Node) bool {
		if ast.IsVariableStatement(node) {
			for _, declaration := range node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if parser.IsSchemaAliasDeclaration(declaration) || declaration.Initializer() == nil || !isSchemaStruct(declaration.Initializer()) {
					continue
				}
				head := strings.TrimSpace(text[nodeStart(file, node):nodeStart(file, declaration.Name())])
				if !strings.HasSuffix(head, "schema") {
					continue
				}
				at := scanner.SkipTrivia(text, declaration.Name().End())
				if at < len(text) && (text[at] == '{' || text[at] == '=') {
					continue
				}
				if !accepts(declaration.Name().End(), declaration.Name().End()) {
					continue
				}
				edits = []sourceEdit{{declaration.Name().End(), declaration.Name().End(), " {}"}}
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return edits
}
