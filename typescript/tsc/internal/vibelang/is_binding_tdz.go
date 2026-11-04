package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Keep the checker's uninitialized let and assignment flow intact. Only emit
// replaces its initial undefined with a private sentinel and guards references.
// A scalar sentinel preserves native per-iteration copying of let bindings.
func (p *plan) planIsBindingTDZ(c *checker.Checker, file *ast.SourceFile) {
	p.isBindingDeclarations = map[*ast.Node]bool{}
	p.isBindingReferences = map[*ast.Node]*ast.Node{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		// A for-each head binding's per-item copy carries its initializer, the
		// head cell read when the item starts: it is not a cell a skipped
		// pattern leaves uninitialized, so it keeps that initializer. Its
		// references still read through the guard, so a head the pattern
		// skipped stays uninitialized in its copy too.
		if ast.IsVariableDeclaration(node) && node.Flags&ast.NodeFlagsVibeLangIsBinding != 0 && node.AsVariableDeclaration().Initializer == nil {
			p.isBindingDeclarations[node] = true
		}
		if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed == 0 {
			shorthand := node.Parent != nil && ast.IsShorthandPropertyAssignment(node.Parent)
			if isValueUse(node) || shorthand {
				symbol := c.GetSymbolAtLocation(node)
				if shorthand {
					symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
				}
				if symbol != nil {
					d := symbol.ValueDeclaration()
					if d != nil && ast.IsVariableDeclaration(d) && d.Flags&ast.NodeFlagsVibeLangIsBinding != 0 {
						p.isBindingReferences[node] = d
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	visit(file.AsNode())
}

func (tx *lowering) visitIsBindingDeclaration(node *ast.Node) *ast.Node {
	d := node.AsVariableDeclaration()
	f := tx.Factory()
	// A function can run through an import cycle before this module's body.
	// Initialize the module's hoisted sentinel lazily and never overwrite it.
	initial := f.NewBinaryExpression(nil, tx.isBindingSentinel(), nil, f.NewToken(ast.KindQuestionQuestionEqualsToken), tx.runtimeCall("$uninitializedBinding"))
	return f.UpdateVariableDeclaration(d, d.Name(), d.ExclamationToken, d.Type, initial)
}

func (tx *lowering) visitIsBindingReference(node *ast.Node) *ast.Node {
	f := tx.Factory()
	value := f.NewIdentifier(node.Text())
	var result *ast.Node
	if ast.IsAssignmentTarget(node) {
		// Keep a reference until GetValue/PutValue. Simple assignment evaluates
		// its RHS before the TDZ check; compound/update/destructuring assignments
		// retain their own native evaluation order and result.
		param := f.NewUniqueName("value")
		parameter := f.NewParameterDeclaration(nil, nil, param, nil, nil, nil)
		assign := f.NewBinaryExpression(nil, f.NewIdentifier(node.Text()), nil, f.NewToken(ast.KindEqualsToken), param)
		constant := f.NewKeywordExpression(ast.KindFalseKeyword)
		if tx.plan.isBindingReferences[node].Flags&ast.NodeFlagsVibeLangConst != 0 {
			constant = f.NewKeywordExpression(ast.KindTrueKeyword)
		}
		ref := tx.runtimeCall("$bindingReference", tx.arrow(nil, value), tx.arrow([]*ast.Node{parameter}, assign), constant, tx.isBindingSentinel())
		result = f.NewPropertyAccessExpression(ref, nil, f.NewIdentifier("value"), ast.NodeFlagsNone)
	} else {
		result = tx.runtimeCall("$readBinding", value, tx.isBindingSentinel())
	}
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}

func (tx *lowering) visitIsBindingShorthand(node *ast.Node) *ast.Node {
	f := tx.Factory()
	value := tx.visitIsBindingReference(node.Name())
	if initializer := node.AsShorthandPropertyAssignment().ObjectAssignmentInitializer; initializer != nil {
		value = f.NewBinaryExpression(nil, value, nil, f.NewToken(ast.KindEqualsToken), tx.visit(initializer))
	}
	name := f.NewIdentifier(node.Name().Text())
	if node.Name().Text() == "__proto__" {
		// A shorthand is an own data property, including this special name.
		name = f.NewComputedPropertyName(f.NewStringLiteral("__proto__", ast.TokenFlagsNone))
	}
	result := f.NewPropertyAssignment(nil, name, nil, nil, value)
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}

// The sentinel is private to this compiled module. A source program can use
// any exported runtime value, including this factory, as ordinary matched
// data without confusing it with an uninitialized lexical cell.
func (tx *lowering) isBindingSentinel() *ast.Node {
	if tx.bindingSentinel == nil {
		tx.bindingSentinel = tx.fileName("$tdz")
	}
	return tx.bindingSentinel
}

// resetIsBindingIteration starts test/update bindings uninitialized in the
// environment native for creates before its update. A let from the initializer
// keeps native copying; a test/update cell must not inherit the prior value
// when short-circuiting skips its pattern. Resetting after the environment copy
// preserves every closure created in the previous body.
func (tx *lowering) resetIsBindingIteration(original, visited *ast.Node) *ast.Node {
	initial := original.AsForStatement().Initializer
	if initial == nil || !ast.IsVariableDeclarationList(initial) {
		return visited
	}
	f := tx.Factory()
	var reset *ast.Node
	for _, declaration := range initial.AsVariableDeclarationList().Declarations.Nodes {
		if declaration.Flags&ast.NodeFlagsVibeLangIterationCell == 0 || !tx.plan.isBindingDeclarations[declaration] {
			continue
		}
		assign := f.NewBinaryExpression(nil, f.NewIdentifier(declaration.Name().Text()), nil, f.NewToken(ast.KindEqualsToken), tx.isBindingSentinel())
		if reset == nil {
			reset = assign
		} else {
			reset = f.NewBinaryExpression(nil, reset, nil, f.NewToken(ast.KindCommaToken), assign)
		}
	}
	if reset == nil {
		return visited
	}
	loop := visited.AsForStatement()
	if loop.Incrementor != nil {
		reset = f.NewBinaryExpression(nil, reset, nil, f.NewToken(ast.KindCommaToken), loop.Incrementor)
	}
	return f.UpdateForStatement(loop, loop.Initializer, loop.Condition, reset, loop.Statement)
}
