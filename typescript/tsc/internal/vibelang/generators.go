package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// An explicit effect function* is a producer (VIP-21), so a native generator
// API cannot consume it. Plain function* stays native, including Effect.gen.

func init() {
	fileChecks = append(fileChecks, checkGeneratorArguments)
}

// iteratorInterfaces are the lib interfaces a JavaScript generator function
// returns. A parameter whose type is a function that returns one of them
// expects a generator.
var iteratorInterfaces = []string{"Generator", "AsyncGenerator", "Iterator", "AsyncIterator", "IterableIterator", "AsyncIterableIterator"}

func checkGeneratorArguments(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			for _, arg := range node.Arguments() {
				if isGeneratorFunction(c, arg) && expectsGenerator(c, arg) && !c.IsResolvedCallApplicable(node) {
					api := apiName(node)
					d := report(c, api, EK1002, scanner.GetSourceTextOfNodeFromSourceFile(file, api, false))
					note(d, "Write the body as an ordinary function: remove {0}, function*, and yield*.", scanner.GetSourceTextOfNodeFromSourceFile(file, api, false))
					// The API mismatch does not own diagnostics within the producer.
					coverArgument(c, arg)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isGeneratorFunction reports whether arg is an explicit producer expression
// or names an explicit producer declared in a .vibe file.
func isGeneratorFunction(c *checker.Checker, arg *ast.Node) bool {
	if ast.IsFunctionExpression(arg) {
		return isProducer(arg)
	}
	decl := generatorDeclaration(c, arg)
	return decl != nil && isProducer(decl)
}

// generatorDeclaration returns the function* declaration in a .vibe file that
// arg, an identifier, names, or nil.
func generatorDeclaration(c *checker.Checker, arg *ast.Node) *ast.Node {
	if !ast.IsIdentifier(arg) {
		return nil
	}
	if symbol := c.GetSymbolAtLocation(arg); symbol != nil {
		if decl := symbol.ValueDeclaration(); decl != nil && ast.IsFunctionDeclaration(decl) && decl.AsFunctionDeclaration().AsteriskToken != nil && isVibeLangFile(ast.GetSourceFileOfNode(decl)) {
			return decl
		}
	}
	return nil
}

// expectsGenerator reports whether arg needs a native generator contract.
// A compatible callback contract takes precedence over a generator overload. Either type may be a union:
// while TypeScript resolves an overloaded call such as Effect.fn("name")(…),
// the contextual type joins what the candidates expect. A call that no
// overload accepts, as Effect.fn("name")(function* …, Effect.orElse…) is while
// function* declares a producer, may give arg another candidate's type, so the
// parameter at arg's position in each of the callee's signatures counts too.
func expectsGenerator(c *checker.Checker, arg *ast.Node) bool {
	contextual := c.GetContextualType(arg, checker.ContextFlagsNone)
	actual := c.GetTypeAtLocation(arg)
	if contextual != nil && len(c.GetSignaturesOfType(contextual, checker.SignatureKindCall)) != 0 && c.IsTypeAssignableTo(actual, contextual) {
		return false
	}
	expected := returnsIterator(c, contextual)
	call := arg.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return expected
	}
	position := slices.Index(call.Arguments(), arg)
	for _, sig := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
		parameter := c.GetTypeAtPosition(sig, position)
		// A self parameter does not supply a callback contract.
		if parameter != nil && len(c.GetSignaturesOfType(parameter, checker.SignatureKindCall)) != 0 && c.IsTypeAssignableTo(actual, parameter) {
			return false
		}
		expected = expected || returnsIterator(c, parameter)
	}
	return expected
}

// returnsIterator reports whether t, or a member of it, is a function type
// that returns one of the lib's iterator interfaces.
func returnsIterator(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	for _, expected := range t.Distributed() {
		for _, sig := range c.GetSignaturesOfType(expected, checker.SignatureKindCall) {
			for _, returned := range c.GetReturnTypeOfSignature(sig).Distributed() {
				if symbol := returned.Symbol(); symbol != nil && slices.Contains(iteratorInterfaces, symbol.Name()) && isLibSymbol(symbol) {
					return true
				}
			}
		}
	}
	return false
}

// isLibSymbol reports whether every declaration of symbol is in a declaration
// file, as the lib iterator interfaces are, so a program's own Generator type
// does not count.
func isLibSymbol(symbol *ast.Symbol) bool {
	return len(symbol.Declarations()) > 0 && !slices.ContainsFunc(symbol.Declarations(), func(d *ast.Node) bool {
		return !ast.GetSourceFileOfNode(d).IsDeclarationFile
	})
}

// apiName returns the node that names the API a call calls: Effect.gen for
// Effect.gen(…), and Effect.fn for Effect.fn("name")(…).
func apiName(call *ast.Node) *ast.Node {
	callee := call.Expression()
	for ast.IsCallExpression(callee) {
		callee = callee.Expression()
	}
	return callee
}
