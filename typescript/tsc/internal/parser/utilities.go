package parser

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func getLanguageVariant(scriptKind core.ScriptKind) core.LanguageVariant {
	switch scriptKind {
	case core.ScriptKindTSX, core.ScriptKindJSX, core.ScriptKindJS, core.ScriptKindJSON:
		// .tsx and .jsx files are treated as jsx language variant.
		return core.LanguageVariantJSX
	}
	return core.LanguageVariantStandard
}

func tokenIsIdentifierOrKeyword(token ast.Kind) bool {
	return token >= ast.KindIdentifier
}

func tokenIsIdentifierOrKeywordOrGreaterThan(token ast.Kind) bool {
	return token == ast.KindGreaterThanToken || tokenIsIdentifierOrKeyword(token)
}

func GetJSDocCommentRanges(f *ast.NodeFactory, commentRanges []ast.CommentRange, node *ast.Node, text string) []ast.CommentRange {
	return getJSDocCommentRanges(f, commentRanges, node, text, false)
}

func getJSDocCommentRanges(f *ast.NodeFactory, commentRanges []ast.CommentRange, node *ast.Node, text string, vibe bool) []ast.CommentRange {
	var trailing bool
	switch node.Kind {
	case ast.KindParameter, ast.KindTypeParameter, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindParenthesizedExpression, ast.KindVariableDeclaration, ast.KindExportSpecifier:
		trailing = true
	case ast.KindPropertySignature, ast.KindPropertyDeclaration, ast.KindMethodSignature, ast.KindMethodDeclaration, ast.KindCallSignature, ast.KindConstructSignature, ast.KindFunctionType, ast.KindConstructorType, ast.KindGetAccessor, ast.KindSetAccessor:
		// A contract can be written on the same line as the opening brace or
		// preceding member separator. The scanner classifies that trivia as trailing.
		trailing = vibe
	}
	if trailing {
		for r := range scanner.GetTrailingCommentRanges(f, text, node.Pos()) {
			commentRanges = append(commentRanges, r)
		}
	}
	for r := range scanner.GetLeadingCommentRanges(f, text, node.Pos()) {
		commentRanges = append(commentRanges, r)
	}
	// Keep if the comment starts with '/**' but not if it is '/**/'
	return slices.DeleteFunc(commentRanges, func(comment ast.CommentRange) bool {
		commentStart := comment.Pos()
		commentLen := comment.End() - commentStart
		return comment.End() > node.End() || commentLen < 4 || text[commentStart+1] != '*' || text[commentStart+2] != '*' || text[commentStart+3] == '/'
	})
}

func isKeywordOrPunctuation(token ast.Kind) bool {
	return ast.IsKeywordKind(token) || ast.IsPunctuationKind(token)
}

func isJSDocLikeText(text string) bool {
	return len(text) >= 4 && text[1] == '*' && text[2] == '*' && text[3] != '/'
}
