package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-1/detail247 gives an already-rejected recognized Effect arrow head
// its own error. Ordinary uses of effect and native arrow errors stay native.
var EK0109 = message(parser.EffectArrowHeadDiagnosticCode, errorCategory, parser.EffectArrowHeadDiagnosticText)

func init() {
	registry[EK0109.Code] = EK0109
	tsFormFixCodes = append(tsFormFixCodes, EK0109.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0109.Code)
	tsFormRules[EK0109.Code] = &tsFormRule{
		message: EK0109,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:    effectArrowHeadRewrite,
		diagnosed: func(n *ast.Node) bool {
			return ast.IsParameterDeclaration(n) && n.Parent != nil && ast.IsArrowFunction(n.Parent)
		},
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0109.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

func bareEffectArrowParameter(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if !ast.IsArrowFunction(node) || !isMarkedEffect(node) || len(node.Parameters()) != 1 {
		return nil
	}
	fn := node.FunctionLikeData()
	parameter := node.Parameters()[0]
	if fn.TypeParameters == nil && parameter.Type() == nil {
		return nil
	}
	text := file.Text()
	at := scanner.SkipTrivia(text, scanner.GetRangeOfTokenAtPosition(file, node.Pos()).End())
	if fn.TypeParameters != nil {
		// A type-parameter list ends before its outer closing >, including
		// when a constraint itself contains generics or a function type.
		close := scanner.SkipTrivia(text, fn.TypeParameters.End())
		if close >= len(text) || text[close] != '>' {
			return nil
		}
		at = scanner.SkipTrivia(text, close+1)
	}
	if at >= len(text) || text[at] == '(' {
		return nil
	}
	return parameter
}

func effectArrowHeadRewrite(_ *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
	if at.Parent == nil || bareEffectArrowParameter(file, at.Parent) != at {
		return nil
	}
	return &formRewrite{
		edits: []sourceEdit{
			{nodeStart(file, at), nodeStart(file, at), "("},
			{at.End(), at.End(), ")"},
		},
		description: "parenthesized effect arrow parameters",
	}
}
