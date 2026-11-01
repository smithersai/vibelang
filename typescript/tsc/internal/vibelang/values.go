package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// expressionType gives a keyword operand its program type: fork e and the
// elements of await.all build a program from their operand by syntax,
// whatever its type (D322, keywords.go). Any other expression keeps the type
// TypeScript gives it: a function never converts at its destination (VIP-1).
func expressionType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if t != nil && mayBeKeywordOperand(node) && !analyzerFor(c).valueTyping[node] {
		if program, ok := analyzerFor(c).keywordOperandType(node, t); ok {
			return program
		}
	}
	return t
}

// valueTypeOf returns the type of node as a value where t, its type in a
// keyword operand, is a placeholder never.
func (a *analyzer) valueTypeOf(node *ast.Node, t *checker.Type) *checker.Type {
	if !isPlaceholderNever(t) || a.valueTyping[node] {
		return t
	}
	a.valueTyping[node] = true
	defer delete(a.valueTyping, node)
	return a.checker.GetTypeAtLocation(node)
}

// nodeText returns the source text of node, without leading trivia. Missing,
// synthesized and invalid recovery spans have no source text.
func nodeText(file *ast.SourceFile, node *ast.Node) string {
	if file == nil || ast.NodeIsMissing(node) {
		return ""
	}
	source := file.Text()
	if node.Pos() < 0 || node.End() < node.Pos() || node.End() > len(source) || node.Pos() > len(source) {
		return ""
	}
	start := scanner.SkipTrivia(source, node.Pos())
	if start > node.End() {
		return ""
	}
	return source[start:node.End()]
}

// mayReturnEffect reports whether t, a function value's type, has a call
// signature whose return type is definitely an Effect or a union with such a
// member: a value of the Effect form, or one that may return a program, which
// no plain function type accepts (D430, D511, D512).
func mayReturnEffect(c *checker.Checker, t *checker.Type) bool {
	if t == nil || isPlaceholderNever(t) {
		return false
	}
	for _, signature := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		returned := c.GetReturnTypeOfSignature(signature)
		if isEffectType(c, returned) {
			return true
		}
		if returned.Flags()&checker.TypeFlagsUnion != 0 {
			for _, member := range returned.Types() {
				if isEffectType(c, member) {
					return true // it may return a program (D512)
				}
			}
		}
	}
	return false
}

// isPlaceholderNever reports whether t is the never that the checker gives a
// generic call it skips during an inference pass, which infers nothing.
func isPlaceholderNever(t *checker.Type) bool {
	return t.Flags()&checker.TypeFlagsNever != 0 && t.ObjectFlags()&checker.ObjectFlagsNonInferrableType != 0
}

// atTopLevel reports whether a module's top level evaluates node, not a
// function or class inside it.
func atTopLevel(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindSourceFile {
			return isVibeLangFile(n.AsSourceFile())
		}
	}
	return false
}

// callsVibeLangFunction reports whether call calls a .vibe function other
// than a producer, whose call builds a Stream.
func (a *analyzer) callsVibeLangFunction(call *ast.Node) bool {
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	fn := implementationOf(signature.Declaration())
	return fn != nil && isLowerable(fn) && !isProducer(fn)
}

// programOf returns the Effect that t, a function with no required parameters
// that returns an Effect, converts to, or nil.
func (a *analyzer) programOf(t *checker.Type) *checker.Type {
	signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
	if len(signatures) != 1 || signatures[0].MinArgumentCount() != 0 || len(signatures[0].TypeParameters()) != 0 {
		return nil
	}
	if returned := a.checker.GetReturnTypeOfSignature(signatures[0]); isEffectType(a.checker, returned) {
		return returned
	}
	return nil
}

// iteratedTypes returns the element types of t and true when t is iterable:
// an array, a tuple, or an object with a [Symbol.iterator] method.
func (a *analyzer) iteratedTypes(t *checker.Type) ([]*checker.Type, bool) {
	if a.checker.IsArrayLikeType(t) {
		return a.elementTypes(t, 0), true
	}
	if element := a.checker.IteratedType(t); element != nil {
		return []*checker.Type{element}, true
	}
	return nil, false
}

// esFunctionOf returns the .vibe function that node, an identifier or a
// namespace member such as M.double, names: a function declaration, or a
// variable initialized with a lambda.
func esFunctionOf(c *checker.Checker, node *ast.Node) *ast.Node {
	if !ast.IsIdentifier(node) && !(ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Name())) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return nil
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil {
		return nil
	}
	if ast.IsVariableDeclaration(declaration) && declaration.Initializer() != nil {
		declaration = ast.SkipParentheses(declaration.Initializer())
	}
	if isLowerable(declaration) {
		return implementationOf(declaration)
	}
	return nil
}

// firstFailureSource returns the throw operand or call in fn's body that adds
// its first expected failure, or nil. A throw expression or a do block, which
// the parser writes as an invoked arrow, gives the throw or call inside it.
func (a *analyzer) firstFailureSource(fn *ast.Node) *ast.Node {
	info := a.flowOf(fn.Body())
	for i, t := range info.errors {
		if source := info.errorSources[i]; t != nil && t.Flags()&checker.TypeFlagsNever == 0 && source != nil {
			if arrow := invokedArrow(source); arrow != nil {
				if inner := a.firstFailureSource(arrow); inner != nil {
					return inner
				}
			}
			return source
		}
	}
	return nil
}

func factoryReturns(fn *ast.Node, cb func(*ast.Node)) {
	if !ast.IsBlock(fn.Body()) {
		cb(fn.Body())
		return
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindReturnStatement {
			cb(n.Expression())
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
}

// declaredProgramReturn returns the Effect type that fn's return annotation
// writes, or nil.
func (a *analyzer) declaredProgramReturn(fn *ast.Node) *checker.Type {
	if fn == nil || !isLowerable(fn) || isProducer(fn) || fn.Type() == nil {
		return nil
	}
	if t := a.checker.GetTypeFromTypeNode(fn.Type()); isEffectType(a.checker, t) {
		return t
	}
	return nil
}

// firstPause returns the first call in fn's own body that performs an Effect
// operation, or nil when fn compiles to plain JavaScript.
func (a *analyzer) firstPause(fn *ast.Node) *ast.Node {
	var pause *ast.Node
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if a.performs(call) {
			pause = call
			return true
		}
		return false
	})
	return pause
}
