package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VibeLangEffectChannelMessage is shared by the syntax diagnostic and its fix.
const VibeLangEffectChannelMessage = "! beside a union, an intersection, a function type or a conditional type without parentheses. Parenthesize the intended type before combining ! with another type operator."

// VibeLangEffectChannelParts returns the written operands that need parentheses.
// Retain the recovered legacy grouping so migration preserves each channel.
func VibeLangEffectChannelParts(node, parent *ast.Node) []*ast.Node {
	if node == nil || !ast.IsTypeReferenceNode(node) {
		return nil
	}
	name := node.AsTypeReferenceNode().TypeName
	if name.Flags&ast.NodeFlagsReparsed == 0 || name.Kind != ast.KindQualifiedName {
		return nil
	}
	q := name.AsQualifiedName()
	if q.Left.Kind != ast.KindIdentifier || q.Left.Text() != "Effect" || q.Right.Text() != "Effect" {
		return nil
	}
	var parts []*ast.Node
	for _, channel := range node.TypeArguments() {
		switch channel.Kind {
		case ast.KindUnionType, ast.KindIntersectionType, ast.KindConditionalType, ast.KindFunctionType, ast.KindConstructorType:
			parts = append(parts, channel)
		}
	}
	// Conditional parts need grouping, but a function type's return is a Type.
	if parent != nil && parent.Kind == ast.KindConditionalType {
		parts = append(parts, node)
	}
	return parts
}

// Run after source parsing, including top-level-await reparsing, so this syntax
// rule applies with --noCheck and sees each operand's actual source parent.
func (p *Parser) checkVibeLangEffectChannels(file *ast.SourceFile) {
	seen := map[core.TextRange]bool{}
	var visit func(*ast.Node, *ast.Node)
	visit = func(node, parent *ast.Node) {
		if len(VibeLangEffectChannelParts(node, parent)) != 0 {
			span := core.NewTextRange(scanner.SkipTrivia(file.Text(), node.Pos()), node.End())
			if !seen[span] {
				file.SetDiagnostics(append(file.Diagnostics(), ast.NewExternalDiagnostic(file, span, "EK", diagnostics.CategoryError, 301, VibeLangEffectChannelMessage)))
				seen[span] = true
			}
		}
		node.ForEachChild(func(child *ast.Node) bool {
			visit(child, node)
			return false
		})
	}
	visit(file.AsNode(), nil)
}

// A completed bang type can be the check of a conditional. Native parseType
// checks for extends before the bang is consumed, so recover this tail here;
// the source-parent walk then reports EK0301 and its fix groups the check.
func (p *Parser) parseVibeLangConditionalCheck(check *ast.TypeNode) *ast.TypeNode {
	if p.inDisallowConditionalTypesContext() || p.hasPrecedingLineBreak() || !p.parseOptional(ast.KindExtendsKeyword) {
		return check
	}
	saved := p.contextFlags
	p.setContextFlags(ast.NodeFlagsTypeExcludesFlags, false)
	extendsType := p.doInContext(ast.NodeFlagsDisallowConditionalTypesContext, true, (*Parser).parseType)
	p.parseExpected(ast.KindQuestionToken)
	trueType := p.doInContext(ast.NodeFlagsDisallowConditionalTypesContext, false, (*Parser).parseType)
	p.parseExpected(ast.KindColonToken)
	falseType := p.doInContext(ast.NodeFlagsDisallowConditionalTypesContext, false, (*Parser).parseType)
	result := p.finishNode(p.factory.NewConditionalTypeNode(check, extendsType, trueType, falseType), check.Pos())
	p.contextFlags = saved
	return result
}
