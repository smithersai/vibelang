package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// lintArrowSuffix marks a contract edit on an arrow function, which keeps its =>.
const lintArrowSuffix = "=>"

func lintArrowContract(self string) string { return self + lintArrowSuffix }

// lintForm lowers, for a Lint projection, a form the checking projection leaves
// as VibeLang text with a diagnostic: its meaning needs types or a rule the
// mapper does not have, and a linter needs only TypeScript that parses with the
// source's own code in place. It reports whether it lowered node.
func (p *projector) lintForm(node *ast.Node, e env) bool {
	switch {
	case node.Kind == ast.KindImportDeclaration && parser.IsVibeLangModuleReference(node.AsImportDeclaration().ModuleSpecifier):
		// import x from text names an inline module; a module declaration
		// itself parses as a namespace.
		p.plan.replace(p.tokenStart(node), node.End(), "")
		return true
	case isBareIsTest(node, p.text):
		// x is T: the subject stays, and the test goes.
		arguments := node.Arguments()
		subject := arguments[len(arguments)-1]
		p.visit(subject, e)
		p.plan.replace(subject.End(), node.End(), "")
		return true
	}
	return false
}

// lintSweep lowers the types and members no walker reached, such as a type
// argument of new or an as: VibeLang syntax left in them is not TypeScript. It
// leaves anything an edit already touches.
func (p *projector) lintSweep() {
	touched := func(start, end int) bool {
		for _, e := range p.plan.edits {
			if e.pos < end && start < max(e.end, e.pos+1) {
				return true
			}
		}
		return false
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		start := p.tokenStart(node)
		switch {
		case isEffectType(node):
			if !touched(start, node.End()) {
				p.effectType(node, false /*slotsOnly*/)
			}
			return false
		case node.Kind == ast.KindPropertySignature && strings.HasPrefix(p.text[start:], "mutable"):
			next := scanner.SkipTrivia(p.text, start+len("mutable"))
			if name := node.Name(); name != nil && next <= p.tokenStart(name) && !touched(start, next) {
				p.plan.replace(start, next, "")
			}
		}
		return node.ForEachChild(visit)
	}
	p.file.AsNode().ForEachChild(visit)
}

// lintEffectArrows returns where each arrow written with the effect keyword now
// starts: lower wrote the keyword over, so the second parse sees a plain arrow.
func lintEffectArrows(text string, keywords []keyword) map[int]bool {
	starts := map[int]bool{}
	for _, k := range keywords {
		switch k.with {
		case "()=>  ":
			starts[k.at] = true
		case "(()=> ", ";()=> ":
			starts[k.at+1] = true
		case ";(()=>":
			starts[k.at+2] = true
		case "      ":
			starts[scanner.SkipTrivia(text, k.at)] = true
		}
	}
	return starts
}

// isBareIsTest recognizes the parser's call for x is T, with T a plain name or
// access: the callee and its copy of T are written after the subject.
func isBareIsTest(node *ast.Node, text string) bool {
	if node.Kind != ast.KindCallExpression || node.Expression().Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	arguments := node.Arguments()
	if len(arguments) != 2 || arguments[1].End() > arguments[0].Pos() {
		return false
	}
	if kind := arguments[0].Kind; kind != ast.KindIdentifier && kind != ast.KindPropertyAccessExpression {
		return false
	}
	between := strings.TrimSpace(text[arguments[1].End():arguments[0].Pos()])
	return between == "is"
}
