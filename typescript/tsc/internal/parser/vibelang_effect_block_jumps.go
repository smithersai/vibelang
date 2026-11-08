package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A source jump leaving an Effect block keeps EK0202 even if its do
// expression must remain a function. Definition-time class expressions
// keep the surrounding block; written callables and item regions do not.
func (p *Parser) doEffectBlockJump(jump *ast.Node) bool {
	if !ast.IsBreakOrContinueStatement(jump) {
		return false
	}
	for child, n := jump, jump.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) || ast.IsClassElement(n) {
			if name := n.Name(); child == name && ast.IsComputedPropertyName(name) || ast.IsDecorator(child) {
				continue
			}
			if d := p.doOfArrow(n); d != nil && !d.match {
				continue
			}
			if isSynthesizedArrow(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				token := n.AsArrowFunction().EqualsGreaterThanToken
				if token.Pos() >= 0 && token.End() <= len(p.sourceText) && p.sourceText[token.Pos():token.End()] == "effect" {
					return true
				}
			}
			return false
		}
		if n.Kind == ast.KindClassStaticBlockDeclaration || n.Kind == ast.KindEnumDeclaration {
			return false
		}
		if label := jump.Label(); label != nil {
			if n.Kind == ast.KindLabeledStatement && n.Label().Text() == label.Text() {
				return false
			}
		} else if ast.IsIterationStatement(n, false) || jump.Kind == ast.KindBreakStatement && n.Kind == ast.KindSwitchStatement {
			return false
		}
	}
	return false
}
