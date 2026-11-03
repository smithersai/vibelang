package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"strings"
)

// An internal Effect factory called only by immediately running its result can
// return a dying Effect at its throw: its callers observe the same defect Exit,
// and the operand still evaluates eagerly, once, at the factory call. A factory
// that escapes or whose result can be stored must refuse: JavaScript can observe
// whether the call throws or returns an Effect, even if their eventual Exits agree.
func preservingEffectFactoryThrows(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string) (fileFix, bool) {
	if site.Kind != ast.KindThrowStatement {
		return fileFix{}, false
	}
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil || !ast.IsFunctionDeclaration(home) || home.Name() == nil || nothrowExported(c, file, home) {
		return fileFix{}, false
	}
	sig := c.GetSignatureFromDeclaration(home)
	if sig == nil || !isEffectfulType(c, c.GetReturnTypeOfSignature(sig)) {
		return fileFix{}, false
	}
	if nothrowHasObservableCleanup(home.Body()) {
		return fileFix{}, false
	}
	symbol := c.GetSymbolAtLocation(home.Name())
	safe := symbol != nil
	uses := 0
	var refs func(*ast.Node) bool
	refs = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			if n.Text() == "eval" {
				safe = false
				return true
			}
			reference := c.GetSymbolAtLocation(n)
			if n.Parent != nil && n.Parent.Kind == ast.KindShorthandPropertyAssignment {
				reference = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if n != home.Name() && reference == symbol {
				call := n.Parent
				if call == nil || !ast.IsCallExpression(call) || call.Expression() != n || !isTry(call) {
					safe = false
					return true
				}
				uses++
			}
		}
		return n.ForEachChild(refs)
	}
	file.AsNode().ForEachChild(refs)
	if !safe || uses == 0 {
		return fileFix{}, false
	}
	found := false
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) {
			return false
		}
		if n.Kind == ast.KindTryStatement {
			safe = false
			return true
		}
		if n.Kind == ast.KindThrowStatement {
			if n == site {
				found = true
			}
			visible := c.ResolveName("die", n, ast.SymbolFlagsValue, false)
			if visible != nil && visible.Flags()&ast.SymbolFlagsAlias != 0 {
				visible = c.GetAliasedSymbol(visible)
			}
			if expected := servicesFor(c).effectExport("Effect", "die"); expected == nil || visible != expected {
				safe = false
				return true
			}
			operand := n.Expression()
			between := file.Text()[nodeStart(file, n)+len("throw") : nodeStart(file, operand)]
			if strings.TrimSpace(between) == "" {
				between = ""
			}
			edits = append(edits, sourceEdit{nodeStart(file, n), nodeStart(file, operand), "return die(" + between}, sourceEdit{operand.End(), operand.End(), ")"})
			return false
		}
		return n.ForEachChild(visit)
	}
	home.Body().ForEachChild(visit)
	if !safe || !found || len(edits) == 0 {
		return fileFix{}, false
	}
	return fileFix{code: EK0401.Code, edits: edits, key: key, siteStart: site.Pos(), siteEnd: site.End(), sited: true}, true
}
