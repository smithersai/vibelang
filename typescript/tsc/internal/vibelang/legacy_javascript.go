package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkLegacyJavaScript)
}

// VIP-1 and VIP-4 (Functions, "Legacy JavaScript") deny the JavaScript
// features that run a string as code or read a function's live arguments
// anywhere in a .vibe file, plain functions included. var has its own check;
// this one covers eval, the Function constructor, arguments, with, the
// .constructor of a function value. checkInlineURIModules owns data:/blob:
// specifiers; globalThis spellings belong to the platform rules.
func checkLegacyJavaScript(c *checker.Checker, file *ast.SourceFile) {
	var global *ast.Symbol
	globalFunction := func() *ast.Symbol {
		if global == nil {
			global = c.GetGlobalSymbol("Function", ast.SymbolFlagsValue, nil)
		}
		return global
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindIdentifier:
			if node.Flags&ast.NodeFlagsReparsed == 0 && isIdentifierReference(node) {
				switch node.Text() {
				case "eval":
					report(c, node, EK0107.With("eval is not allowed in a .vibe file: it runs a string as code. Move the code to a .ts or .js file."))
				case "arguments":
					report(c, node, EK0107.With("arguments is not allowed in a .vibe file. Declare a rest parameter, (...args), and read it instead."))
				case "Function":
					if functionConstructorExempt(node) {
						break
					}
					if symbol := c.GetSymbolAtLocation(node); symbol != nil && globalFunction() != nil && c.GetMergedSymbol(symbol) == globalFunction() {
						report(c, node, EK0107.With("Function reaches the Function constructor, which runs a string as code. Move the code to a .ts or .js file; x instanceof Function and Function.prototype stay allowed."))
					}
				}
			}
		case ast.KindWithStatement:
			reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK0107.With("with is not allowed in a .vibe file. Read the properties through the object, or keep legacy JavaScript in a .ts file."))
		case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
			// VIP-1/detail75 bans reads. A simple assignment or a
			// destructuring/iteration target does not obtain the constructor.
			if !legacyAccessReadsValue(node) {
				break
			}
			if name := legacyAccessedName(node); name != nil && name.Text() == "constructor" && isFunctionValue(c, node.Expression()) {
				report(c, name, EK0107.With("constructor of a function value reaches the Function constructor, which runs a string as code. Move the code to a .ts or .js file."))
			}

		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isIdentifierReference tells ECMAScript's IdentifierReference, a name read
// or written as an expression, from a declaration name, a property name, a
// label and a type reference.
func isIdentifierReference(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil || ast.IsRightSideOfQualifiedNameOrPropertyAccess(node) {
		return false
	}
	if ast.IsTypeQueryNode(parent) || ast.IsJSDocLinkLike(parent) || ast.IsJSDocNameReference(parent) || ast.IsPartOfTypeNode(node) {
		return false
	}
	if parent.Kind == ast.KindShorthandPropertyAssignment {
		return parent.Name() == node
	}
	return ast.IsExpressionNode(node)
}

// functionConstructorExempt is VIP-1's two exemptions: the right operand of
// instanceof, and the object of a statically named prototype access.
func functionConstructorExempt(node *ast.Node) bool {
	parent := node.Parent
	if ast.IsBinaryExpression(parent) {
		b := parent.AsBinaryExpression()
		return b.OperatorToken.Kind == ast.KindInstanceOfKeyword && b.Right == node
	}
	if name := legacyAccessedName(parent); name != nil && parent.Expression() == node && name.Text() == "prototype" {
		return true
	}
	return false
}

// legacyAccessedName is the statically named member of a property or element
// access: its name, or a string literal without substitutions.
func legacyAccessedName(node *ast.Node) *ast.Node {
	switch node.Kind {
	case ast.KindPropertyAccessExpression:
		return node.Name()
	case ast.KindElementAccessExpression:
		if argument := node.AsElementAccessExpression().ArgumentExpression; argument != nil && ast.IsStringLiteralLike(argument) {
			return argument
		}
	}
	return nil
}

// isFunctionValue reports whether the static type of expression is a function
// type or Function. any, unknown and the error type are not.
func isFunctionValue(c *checker.Checker, expression *ast.Node) bool {
	t := c.GetTypeAtLocation(expression)
	if t == nil || t == c.GetErrorType() || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return false
	}
	if t == c.GetGlobalFunctionType() {
		return true
	}
	return len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) > 0 || len(c.GetSignaturesOfType(t, checker.SignatureKindConstruct)) > 0
}

// Assertion wrappers erase without reading the underlying reference. Deleting
// a property evaluates its base/key, but never obtains the property's value.
func legacyAccessReadsValue(node *ast.Node) bool {
	for node.Parent != nil && ast.IsOuterExpression(node.Parent, ast.OEKParentheses|ast.OEKAssertions) && node.Parent.Expression() == node {
		node = node.Parent
	}
	return !ast.IsWriteOnlyAccess(node) && (node.Parent == nil || node.Parent.Kind != ast.KindDeleteExpression)
}
