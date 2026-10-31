package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// In a .vibe file, function* declares a producer (Chapter 8), so an API that
// takes a JavaScript generator, such as Effect.gen, Effect.fn, Option.gen, or
// Result.gen, cannot be called with an unannotated one: EK1002 (Chapter 10).
// D271 permits an explicit JavaScript iterator return annotation instead.

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
				if isGeneratorFunction(c, arg) && expectsGenerator(c, arg) {
					api := apiName(node)
					d := report(c, api, EK1002, scanner.GetSourceTextOfNodeFromSourceFile(file, api, false))
					note(d, "Write the body as an ordinary function: remove {0}, function*, and yield*.", scanner.GetSourceTextOfNodeFromSourceFile(file, api, false))
					noteEffectGenFix(c, file, d, node)
					cover(c, arg) // a function expression's body has no VibeLang meaning
					if decl := generatorDeclaration(c, arg); decl != nil && ast.GetSourceFileOfNode(decl) == file {
						cover(c, decl) // nor has the body of a producer written for it
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isGeneratorFunction reports whether arg is a function* expression, or names
// a function* declared in a .vibe file.
func isGeneratorFunction(c *checker.Checker, arg *ast.Node) bool {
	if ast.IsFunctionExpression(arg) {
		return arg.AsFunctionExpression().AsteriskToken != nil && !vibelangmapper.HasJavaScriptIteratorReturn(arg)
	}
	decl := generatorDeclaration(c, arg)
	return decl != nil && !vibelangmapper.HasJavaScriptIteratorReturn(decl)
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

// expectsGenerator reports whether the parameter that receives arg is a
// function that returns a JavaScript iterator. Either type may be a union:
// while TypeScript resolves an overloaded call such as Effect.fn("name")(…),
// the contextual type joins what the candidates expect. A call that no
// overload accepts, as Effect.fn("name")(function* …, Effect.orElse…) is while
// function* declares a producer, may give arg another candidate's type, so the
// parameter at arg's position in each of the callee's signatures counts too.
func expectsGenerator(c *checker.Checker, arg *ast.Node) bool {
	if returnsIterator(c, c.GetContextualType(arg, checker.ContextFlagsNone)) {
		return true
	}
	call := arg.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return false
	}
	position := slices.Index(call.Arguments(), arg)
	for _, sig := range c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall) {
		if returnsIterator(c, c.GetTypeAtPosition(sig, position)) {
			return true
		}
	}
	return false
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
