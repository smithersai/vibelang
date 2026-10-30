package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaEmptyArguments)
	ls.RegisterCodeFixProvider(schemaEmptyArgumentsFix)
}

// Schema mapping replaces type references with their values, so TypeScript
// no longer sees their original type argument lists. Check the discarded
// empty list in every mapped position, including aliases and error fields.
func checkSchemaEmptyArguments(c *checker.Checker, file *ast.SourceFile) {
	seen := map[core.TextRange]bool{}
	visited := map[*ast.Node]bool{}
	var value func(*ast.Node)
	value = func(n *ast.Node) {
		if n == nil || visited[n] {
			return
		}
		visited[n] = true
		if ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) {
			s := scanner.NewScanner()
			s.SetText(file.Text())
			s.ResetPos(n.End())
			if s.Scan() == ast.KindLessThanToken && s.Scan() == ast.KindGreaterThanToken {
				span := core.NewTextRange(scanner.SkipTrivia(file.Text(), n.Pos()), s.TokenEnd())
				if !seen[span] {
					text := file.Text()[span.Pos():span.End()]
					if _, ok := emptySchemaArgumentsReplacement(text); ok {
						seen[span] = true
						reportAt(c, file, span, EK2109.With("An empty type argument list has no schema form; remove <> from {0}."), entityText(n))
					}
				}
			}
			return
		}
		switch n.Kind {
		case ast.KindCallExpression:
			// Only generated combinators contain mapped types. Written calls
			// in computed field names are ordinary TypeScript expressions.
			if n.Expression().Flags&ast.NodeFlagsReparsed != 0 {
				for _, argument := range n.Arguments() {
					value(argument)
				}
			}
		case ast.KindArrayLiteralExpression:
			for _, element := range n.AsArrayLiteralExpression().Elements.Nodes {
				value(element)
			}
		case ast.KindObjectLiteralExpression:
			for _, property := range n.AsObjectLiteralExpression().Properties.Nodes {
				if ast.IsPropertyAssignment(property) {
					value(property.Initializer())
				}
			}
		}
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isSchemaAlias(n):
			value(n.Initializer())
		case isSchemaStruct(n), isSchemaErrorFields(n):
			value(n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Keep the reference and every comment. Parentheses keep a line comment
// inside the reference when an array or indexed type follows the old >.
func emptySchemaArgumentsReplacement(text string) (string, bool) {
	const prefix = "type __EmptySchemaArguments = "
	source := prefix + text + ";"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/empty-schema-arguments.ts", PathKey: "/empty-schema-arguments.ts"}, source, core.ScriptKindTS)
	if len(file.Statements.Nodes) != 1 || file.Statements.Nodes[0].Kind != ast.KindTypeAliasDeclaration {
		return "", false
	}
	n := file.Statements.Nodes[0].Type()
	if n == nil || n.Kind != ast.KindTypeReference {
		return "", false
	}
	args := n.AsTypeReferenceNode().TypeArguments
	if args == nil || len(args.Nodes) != 0 {
		return "", false
	}
	open := args.Pos() - 1 - len(prefix)
	close := scanner.SkipTrivia(source, args.End()) - len(prefix)
	if open < 0 || close >= len(text) || text[open] != '<' || text[close] != '>' || close+1 != len(text) {
		return "", false
	}
	return "(" + text[:open] + text[open+1:close] + ")", true
}

var schemaEmptyArgumentsFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.Span.End() > len(fix.SourceFile.Text()) {
			return nil, nil
		}
		replacement, ok := emptySchemaArgumentsReplacement(fix.SourceFile.Text()[fix.Span.Pos():fix.Span.End()])
		if !ok {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Write the schema reference without empty type arguments",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: replacement}},
		}}, nil
	},
}
