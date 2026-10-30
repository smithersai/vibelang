package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

func (p *projector) runningExpressionCalls(expression *ast.Node) (pauses, known bool) {
	known = true
	r := p.forms.(*Resolver)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if formsBoundary(node) {
			return false
		}
		if ast.IsCallExpression(node) {
			if isCatchExpression(node) || p.isMatchForm(node) || tryOperationHelper(node) != "" || r.returnsEffect(node) {
				pauses = true
				return false
			}
			c := r.Callee(node)
			if c.Kind == CalleeLocal {
				if root, chain, ok := formsNameChain(node.Expression()); ok && len(chain) == 0 {
					if d := r.binding(root, root.Text()); d != nil && d.Kind == ast.KindVariableDeclaration {
						if init := d.Initializer(); init != nil && isLambda(ast.SkipParentheses(init)) {
							decision := p.forms.Lambda(ast.SkipParentheses(init))
							known = known && decision.Choice == nil && !decision.Ambiguous
							pauses = pauses || decision.Form != FormPlain
							return node.ForEachChild(visit)
						}
						if t := formsUnwrapType(d.Type()); t != nil && t.Kind == ast.KindFunctionType {
							pauses = pauses || r.isEffectTypeNode(t.Type(), 0)
							return node.ForEachChild(visit)
						}
					}
				}
			}
			sigs, _ := r.signaturesOf(c)
			candidates := formsCandidates(sigs, len(node.Arguments()))
			if len(candidates) == 0 {
				// Parameters with written function types have no Callee key.
				callee := node.Expression()
				if ast.IsIdentifier(callee) {
					if d := r.binding(callee, callee.Text()); d != nil && d.Type() != nil {
						t := formsUnwrapType(d.Type())
						if t.Kind == ast.KindFunctionType {
							pauses = pauses || r.isEffectTypeNode(t.Type(), 0)
							return node.ForEachChild(visit)
						}
					}
				}
				known = false
			} else {
				for _, sig := range candidates {
					isEffect := sig.Result == "effect/Effect"
					if isEffect != (candidates[0].Result == "effect/Effect") {
						known = false
					}
					pauses = pauses || isEffect
				}
			}
		}
		return node.ForEachChild(visit)
	}
	visit(expression)
	return
}

func (p *projector) formChoice(at *ast.Node, message string) {
	start := p.tokenStart(at)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: max(0, at.End()-start), Code: CodeFormChoice, Message: message})
}
