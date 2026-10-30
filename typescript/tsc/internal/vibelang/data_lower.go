package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A variant pattern (D307) is a call of $is whose matcher is a data
// variant's constructor (data.go). It runs as the data type's own guard,
// which tests the tag, as when { _tag: "Sent" } does:
//
//	if ($is(Delivery.Sent, d)) { ... }      if (Delivery.$is("Sent")(d)) { ... }
//
// $is cannot run it: Effect's constructors object makes a new constructor
// each time a variant is read, so nothing tells $is that a function is a
// variant's constructor rather than a predicate.

// dataPlan records the variant patterns of one file.
type dataPlan struct {
	variantTests map[*ast.Node]string // $is calls whose matcher is a data variant, to the variant's tag
	keepsIs      bool                 // some other $is call stays, so the file imports $is

	// builtinTests holds the $is calls whose matcher resolves to a built-in
	// matcher, and the test each becomes (match_builtins.go).
	builtinTests map[*ast.Node]builtinTest
}

func newDataPlan() dataPlan {
	return dataPlan{variantTests: map[*ast.Node]string{}, builtinTests: map[*ast.Node]builtinTest{}}
}

// planVariantTest records node when it is a variant pattern's $is call.
func (p *dataPlan) planVariantTest(c *checker.Checker, node *ast.Node) {
	if isPatternCall(node, "$extract") {
		if builtin, ok := builtinMatcherOf(c, node.Arguments()[0]); ok && fixedErrorGuards[builtin.Module] != nil {
			p.builtinTests[node] = builtinTest{guard: builtin.Guard, extract: true}
		}
		return
	}
	if !isPatternCall(node, "$is") {
		return
	}
	if tag := dataVariantTest(c, node); tag != "" {
		p.variantTests[node] = tag
	} else if builtin, ok := builtinMatcherOf(c, node.Arguments()[0]); ok {
		p.builtinTests[node] = builtinTest{typeOf: builtin.TypeOf, guard: builtin.Guard}
	} else {
		p.keepsIs = true
	}
}

// withoutUnusedIs removes $is from names, a file's prelude uses, when every
// $is call of the file is a variant pattern's.
func (p *dataPlan) withoutUnusedIs(names []string) []string {
	if p.keepsIs || len(p.variantTests)+len(p.builtinTests) == 0 {
		return names
	}
	return slices.DeleteFunc(names, func(name string) bool { return name == "$is" })
}

// visitVariantTest writes node, $is(Name.Variant, subject), as
// Name.$is("Variant")(subject).
func (tx *lowering) visitVariantTest(node *ast.Node, tag string) *ast.Node {
	f := tx.Factory()
	matcher, subject := node.Arguments()[0], node.Arguments()[1]
	constructors := tx.Visitor().VisitNode(matcher.Expression())
	guardOf := f.NewPropertyAccessExpression(constructors, nil /*questionDotToken*/, f.NewIdentifier("$is"), ast.NodeFlagsNone)
	guard := f.NewCallExpression(guardOf, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{f.NewStringLiteral(tag, ast.TokenFlagsNone)}), ast.NodeFlagsNone)
	call := f.NewCallExpression(guard, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{tx.Visitor().VisitNode(subject)}), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(call, node)
	call.Loc = node.Loc
	return call
}
