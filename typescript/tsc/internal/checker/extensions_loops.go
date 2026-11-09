package checker

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// IteratedElementTypeHook can give the type of the elements that node
// iterates, where node is a for...of statement or a yield* expression and
// iterated is the type of the value it iterates. An in-tree language
// extension uses it for a value that JavaScript cannot iterate but the
// extension can, such as an Effect Stream. It returns nil when it has nothing
// to say, and TypeScript then iterates iterated as usual.
type IteratedElementTypeHook func(c *Checker, node *ast.Node, iterated *Type) *Type

var iteratedElementTypeHooks []IteratedElementTypeHook

// RegisterIteratedElementTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterIteratedElementTypeHook(hook IteratedElementTypeHook) {
	iteratedElementTypeHooks = append(iteratedElementTypeHooks, hook)
}

func (c *Checker) iteratedElementTypeFromHooks(node *ast.Node, iterated *Type) *Type {
	for _, hook := range iteratedElementTypeHooks {
		if t := hook(c, node, iterated); t != nil {
			return t
		}
	}
	return nil
}

// checkForOfOperand checks that the operand of a for...of is not unknown,
// null or undefined, as TypeScript does. A lowering may hold the operand in a
// generated constant: a for try head, a head with an is binding, or the
// result of a do expression. TypeScript's diagnostic names the operand, or
// calls it an object, so it is reported for the written operand, as in the
// same loop without the constant, and never names the constant.
func (c *Checker) checkForOfOperand(operand *ast.Node) *Type {
	t := c.checkExpression(operand)
	source, written := c.forOfOperandSource(operand)
	if written {
		return c.checkNonNullType(t, source)
	}
	// A do expression is not a name: its value is an object to TypeScript.
	if c.strictNullChecks && t.flags&TypeFlagsUnknown != 0 {
		c.error(source, diagnostics.Object_is_of_type_unknown)
		return c.errorType
	}
	return c.checkNonNullTypeWithReporter(t, source, func(c *Checker, node *ast.Node, facts TypeFacts) {
		c.error(node, core.IfElse(facts&TypeFactsIsUndefined != 0,
			core.IfElse(facts&TypeFactsIsNull != 0,
				diagnostics.Object_is_possibly_null_or_undefined,
				diagnostics.Object_is_possibly_undefined),
			diagnostics.Object_is_possibly_null))
	})
}

// forOfOperandSource follows the constants a lowering generated at a for...of
// operand back to the expression the source wrote there. It reports false
// when the last constant has no initializer: the result of a do expression,
// which its block assigns. A binding the source named, such as a pattern
// binding, is declared elsewhere and is returned as written.
func (c *Checker) forOfOperandSource(operand *ast.Node) (*ast.Node, bool) {
	source := operand
	// One constant may hold another: a for try head over a do expression.
	for range 4 {
		if !ast.IsIdentifier(source) || source.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
			break
		}
		declaration := c.getResolvedSymbol(source).ValueDeclaration()
		if declaration == nil || !ast.IsVariableDeclaration(declaration) || !startAtSamePosition(declaration.Name(), source) {
			break
		}
		if declaration.Initializer() == nil {
			return source, false
		}
		source = declaration.Initializer()
	}
	return source, true
}

func startAtSamePosition(a, b *ast.Node) bool {
	file := ast.GetSourceFileOfNode(a)
	return file != nil && file == ast.GetSourceFileOfNode(b) &&
		scanner.SkipTrivia(file.Text(), a.Pos()) == scanner.SkipTrivia(file.Text(), b.Pos())
}

// isVibeLangConcurrentItemDeclaration recognizes the source head declared
// from a generated item parameter. It keeps native for-of underscore rules
// without exempting ordinary declarations in the written body.
func isVibeLangConcurrentItemDeclaration(node *ast.Node) bool {
	if node == nil || !ast.IsVariableDeclaration(node) {
		return false
	}
	value := node.Initializer()
	if value == nil || !ast.IsIdentifier(value) || value.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return false
	}
	fn := ast.FindAncestor(node, func(n *ast.Node) bool { return ast.IsArrowFunction(n) && n.Flags&ast.NodeFlagsVibeLang != 0 })
	if fn == nil || len(fn.Parameters()) != 1 {
		return false
	}
	parameter := fn.Parameters()[0].Name()
	call := fn.Parent
	if parameter == nil || !ast.IsIdentifier(parameter) || parameter.Flags&ast.NodeFlagsVibeLangTemporary == 0 || parameter.Text() != value.Text() || call == nil || !ast.IsCallExpression(call) {
		return false
	}
	callee := call.Expression()
	return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && callee.Text() == "$forConcurrent"
}
