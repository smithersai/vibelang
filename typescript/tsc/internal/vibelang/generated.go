package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// Code the lowering makes, which no source code stands for, maps to no
// source position (printer.EFNoSourcePosition), so tools that read source
// maps, such as V8 coverage, count the code its author wrote: one function
// for each source function, and none for a thunk that passes a call by name
// (D147), the operands of a catch expression (D236), the function of a
// throw or do expression (D186, D187), a region's closure (D36), or a
// generator that runs a function's body.
//
// One source function that lowers to two functions keeps its position on
// the function its callers call, which binds its parameters: an Effect
// function declaration's forwarding declaration (its generator maps to
// none), a function or method whose body returns a direct Effect (D274; its
// thunk maps to none), a method's Effect.gen generator, and a plain
// function's $direct variant (its Effect wrapper maps to none, since .vibe
// callers call the variant).

// generated marks node, a function or statement the lowering made, as code
// that maps to no source position, and returns it.
func (tx *lowering) generated(node *ast.Node) *ast.Node {
	tx.EmitContext().AddEmitFlags(node, printer.EFNoSourcePosition)
	return node
}

// generatedFunctions marks the outermost functions in node, which is node
// itself when it is a function, as generated, and returns node. A generator
// expression may be an object literal's method, as in `{ *name() {} }.name`.
func (tx *lowering) generatedFunctions(node *ast.Node) *ast.Node {
	var mark func(*ast.Node) bool
	mark = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) {
			tx.generated(n)
			return false
		}
		n.ForEachChild(mark)
		return false
	}
	mark(node)
	return node
}

// generatedThunk returns `(parameters) => { return value; }`, a function the
// lowering made, whose value is an expression of a source statement: a
// concise body would count as a statement of its own. The printer
// parenthesizes a value whose leading comments end in a line break, which
// would otherwise end the return (willEmitMovedLeadingNewLine).
func (tx *lowering) generatedThunk(parameters []*ast.Node, value *ast.Node) *ast.Node {
	f := tx.Factory()
	body := f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(value))}), false /*multiLine*/)
	return tx.generated(tx.arrow(parameters, body))
}

// isProgramArrow reports whether node is an arrow function the parser writes
// for a VibeLang form that holds a program, such as a catch expression's
// operands, a throw or do expression, a block param, or a fork: its => has
// no source text of its own.
func isProgramArrow(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindArrowFunction && node.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0
}

// programArrowRole says what the thunk of node's direct Effect stands for,
// where node is a program arrow. A catch expression's left side runs
// whenever the catch does, so it adds no statement; the value of any other
// program arrow, such as a catch expression's fallback, a throw expression,
// or a for concurrent loop's body, runs only sometimes, so the thunk's body
// counts as a statement, as an arrow's body does in the Effect TypeScript
// the form abbreviates.
func programArrowRole(node *ast.Node) thunkRole {
	if call := catchExpressionOf(node.Parent); call != nil && call.Arguments()[0] == node {
		return thunkIsNothing
	}
	return thunkIsReturn
}

// markProgramArrows marks every function in node that the lowering made from
// a program arrow (isProgramArrow) as generated.
func (tx *lowering) markProgramArrows(node *ast.Node) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) && isProgramArrow(tx.EmitContext().MostOriginal(n)) {
			tx.generated(n)
		}
		n.ForEachChild(visit)
		return false
	}
	visit(node)
}
