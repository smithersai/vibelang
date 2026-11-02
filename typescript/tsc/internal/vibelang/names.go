package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Debugging (design D36). A compiled function is a generator function named
// after its source, so a stack trace and a debugger's call stack show the
// VibeLang function by name:
//
//	export const greet = Effect.fnUntraced(function* greet(name) { … })
//
// A named function expression binds its name inside its own body, which
// would capture the body's references to the function itself: fact(n - 1)
// would call the generator, not the Effect function. When the body or a
// parameter's default refers to the name, the generator is a method of an
// object literal instead, which has the name and binds nothing:
//
//	const fact = Effect.fnUntraced({ *fact(n) { … yield* fact(n - 1) … } }.fact)
//
// A function expression's own name is its binding in the source. When its
// body or parameters refer to it, the name must still be the Effect function,
// so an Effect function expression forwards to its generator in the method
// form, as a declaration does (selfBoundFunction, frames_lower.go):
//
//	const f = function fact(n) { return Effect.fnUntraced({ *fact(n) { … } }.fact).apply(this, arguments) }

// generatorExpression returns the generator for original, a function the
// lowering turns into an Effect, named name: `function* name(…) { … }`,
// the method form when original's body or parameters refer to name, or an
// anonymous generator when name is "". A function expression's own name
// stays its generator's binding; an Effect function expression that refers
// to it binds it itself (selfBoundFunction, frames_lower.go).
func (tx *lowering) generatorExpression(original *ast.Node, name string, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	ownName := original.Kind == ast.KindFunctionExpression && original.Name() != nil
	// A property key is not necessarily a legal generator binding: retry's
	// `while` callback, `yield`, `arguments`, and quoted keys need the method
	// form. Quoting the method and its access also keeps arbitrary keys valid.
	if name != "" && !ownName && (!scanner.IsIdentifierText(name, core.LanguageVariantStandard) || ast.IsKeyword(scanner.StringToToken(name)) || name == "eval" || name == "arguments") {
		method := f.NewMethodDeclaration(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), f.NewStringLiteral(name, ast.TokenFlagsNone), nil /*postfixToken*/, nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, body)
		tx.EmitContext().SetOriginal(method, original) // the method binds what original binds (frames_lower.go)
		object := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{method}), false /*multiLine*/)
		return f.NewElementAccessExpression(object, nil /*questionDotToken*/, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
	}
	if name == "" || ownName || !refersToName(original, name) {
		var id *ast.Node
		if name != "" {
			id = f.NewIdentifier(name)
		}
		return f.NewFunctionExpression(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), id, nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, body)
	}
	method := f.NewMethodDeclaration(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), f.NewIdentifier(name), nil /*postfixToken*/, nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, body)
	tx.EmitContext().SetOriginal(method, original) // the method binds what original binds (frames_lower.go)
	object := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{method}), false /*multiLine*/)
	return f.NewPropertyAccessExpression(object, nil /*questionDotToken*/, f.NewIdentifier(name), ast.NodeFlagsNone)
}

// refersTo reports whether node contains an identifier named name, other
// than a property name after a dot. It may answer true for a name that a
// nested scope declares, which only costs the method form.
func refersTo(node *ast.Node, name string) bool {
	if node == nil {
		return false
	}
	if ast.IsIdentifier(node) && node.Text() == name && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(node) {
		return true
	}
	return node.ForEachChild(func(child *ast.Node) bool { return refersTo(child, name) })
}

// refersToName reports whether fn's body, or a default or computed key in its
// parameters, refers to name (refersTo), as `function f(g = f)` does. A
// parameter's own name does not: it binds in the generator too.
func refersToName(fn *ast.Node, name string) bool {
	for _, parameter := range fn.Parameters() {
		if parameterRefersTo(parameter, name) {
			return true
		}
	}
	return refersTo(fn.Body(), name)
}

// parameterRefersTo reports whether node, a parameter or a part of one, has
// an identifier named name other than a name it declares, a property name
// after a dot, or a type.
func parameterRefersTo(node *ast.Node, name string) bool {
	switch {
	case node == nil || node.Kind >= ast.KindFirstTypeNode && node.Kind <= ast.KindLastTypeNode:
		return false
	case ast.IsIdentifier(node):
		return node.Text() == name && !ast.IsDeclarationName(node) && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(node)
	}
	return node.ForEachChild(func(child *ast.Node) bool { return parameterRefersTo(child, name) })
}

// sourceName returns the name the source gives fn: its own name, the name of
// the variable or property it initializes, or "".
func sourceName(fn *ast.Node) string {
	if name := functionName(fn); name != "" {
		return name
	}
	if parent := fn.Parent; parent != nil && parent.Kind == ast.KindPropertyAssignment && parent.Initializer() == fn {
		return declarationName(parent)
	}
	return ""
}

// captureValue prevents an emitter-generated binding from becoming the
// NamedEvaluation context of a source anonymous function or class. Do it
// before creation: a class static initializer may already observe its name.
func (tx *lowering) captureValue(value *ast.Node) *ast.Node {
	if value == nil {
		return nil
	}
	original := ast.SkipOuterExpressions(value, ast.OEKParentheses|ast.OEKTypeAssertions|ast.OEKNonNullAssertions|ast.OEKSatisfies|ast.OEKPartiallyEmittedExpressions)
	switch original.Kind {
	case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindClassExpression:
		if original.Name() == nil {
			f := tx.Factory()
			return f.NewParenthesizedExpression(f.NewBinaryExpression(nil, f.NewVoidZeroExpression(), nil, f.NewToken(ast.KindCommaToken), value))
		}
	}
	return value
}
