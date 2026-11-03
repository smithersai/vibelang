package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"strings"
)

// Effect.suspend invokes its inline callback and immediately runs its result.
// Returning die preserves its native exception, provided no native cleanup can
// distinguish a throw completion from a return. A throw expression must itself
// supply the returned Effect; an operand of another call cannot become data.
func preservingSuspendThrows(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string) (fileFix, bool) {
	if site.Kind != ast.KindThrowStatement || site.Expression() == nil {
		return fileFix{}, false
	}
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil || !ast.IsFunctionExpressionOrArrowFunction(home) || ast.IsFunctionExpression(home) && home.Name() != nil || home.Body() == nil {
		return fileFix{}, false
	}
	body := home.Body()
	if site.Pos() < body.Pos() || site.End() > body.End() || nothrowHasObservableCleanup(body) {
		return fileFix{}, false
	}
	sig := c.GetSignatureFromDeclaration(home)
	if sig == nil || !isEffectfulType(c, c.GetReturnTypeOfSignature(sig)) {
		return fileFix{}, false
	}
	n := home
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	call := n.Parent
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 1 || call.Arguments()[0] != n || !isEffectFunction(c, call.Expression(), "Effect", "suspend") {
		return fileFix{}, false
	}
	expression := false
	for p := site.Parent; p != nil && p != home; p = p.Parent {
		if !isProgramArrow(p) {
			continue
		}
		expression = true
		q := p
		for q.Parent != nil && ast.IsParenthesizedExpression(q.Parent) {
			q = q.Parent
		}
		outer := q.Parent
		if outer == nil || !ast.IsCallExpression(outer) || invokedArrow(outer) != p || !strings.HasPrefix(nodeText(file, outer), "throw") || !suspendedEffectTail(outer, home) {
			return fileFix{}, false
		}
		break
	}
	visible := c.ResolveName("die", site, ast.SymbolFlagsValue, false)
	if visible != nil && visible.Flags()&ast.SymbolFlagsAlias != 0 {
		visible = c.GetAliasedSymbol(visible)
	}
	if expected := servicesFor(c).effectExport("Effect", "die"); expected == nil || visible != expected {
		return fileFix{}, false
	}
	operand := site.Expression()
	start := nodeStart(file, site)
	at := nodeStart(file, operand)
	if start+len("throw") > at || at >= operand.End() {
		return fileFix{}, false
	}
	between := file.Text()[start+len("throw") : at]
	if strings.TrimSpace(between) == "" {
		between = ""
	}
	prefix := "return die("
	if expression {
		prefix = "die("
	}
	return fileFix{code: EK0401.Code, key: key, sited: true, siteStart: site.Pos(), siteEnd: site.End(), edits: []sourceEdit{{start, at, prefix + between}, {operand.End(), operand.End(), ")"}}}, true
}

func suspendedEffectTail(n, home *ast.Node) bool {
	for n != nil && n.Parent != nil {
		p := n.Parent
		if p == home {
			return home.Body() == n
		}
		if ast.IsReturnStatement(p) {
			if p.Expression() != n {
				return false
			}
			for q := p.Parent; q != nil; q = q.Parent {
				if q == home {
					return true
				}
				if ast.IsFunctionLike(q) {
					return false
				}
			}
			return false
		}
		switch p.Kind {
		case ast.KindParenthesizedExpression:
			n = p
		case ast.KindConditionalExpression:
			v := p.AsConditionalExpression()
			if v.WhenTrue != n && v.WhenFalse != n {
				return false
			}
			n = p
		case ast.KindBinaryExpression:
			b := p.AsBinaryExpression()
			if b.Right != n {
				return false
			}
			switch b.OperatorToken.Kind {
			case ast.KindBarBarToken, ast.KindAmpersandAmpersandToken, ast.KindQuestionQuestionToken:
				n = p
			default:
				return false
			}
		default:
			return false
		}
	}
	return false
}
