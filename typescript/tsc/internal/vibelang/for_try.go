package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

var (
	EK2001     = message(2001, errorCategory, "for try consumes a Stream inside effect code; move this loop into an effect function or block.")
	EK2002     = message(2002, errorCategory, "return cannot leave a for try body; use break to stop consuming the Stream, then return after the loop.")
	EK2003     = message(2003, errorCategory, "A labeled jump cannot leave a for try body; move the decision after the loop.")
	EK2004     = message(2004, errorCategory, "for try requires a Stream.")
	// EK2004's conversion hint follows the operand's type: an AsyncIterable
	// converts with Stream.fromAsyncIterable, an array or other Iterable with
	// Stream.fromIterable, and any other operand gets no conversion.
	ek2004AsyncIterable = EK2004.With("for try requires a Stream; convert this AsyncIterable with Stream.fromAsyncIterable first.")
	ek2004Array         = EK2004.With("for try requires a Stream; convert this array with Stream.fromIterable first.")
	ek2004Iterable      = EK2004.With("for try requires a Stream; convert this Iterable with Stream.fromIterable first.")
	forTryHead = message(parser.StreamHeadDiagnosticCode, errorCategory, parser.StreamHeadDiagnosticText)
)

func isForTry(n *ast.Node) bool {
	return n != nil && n.Kind == ast.KindForOfStatement && n.Flags&ast.NodeFlagsVibeLang != 0
}

func init() {
	for _, m := range []*Message{EK2001, EK2002, EK2003, EK2004} {
		registry[m.Code] = m
	}
	registry[forTryHead.Code] = forTryHead
	fileChecks = append(fileChecks, checkForTry)
}

func checkForTry(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isForTry(n) {
			if !inEffectCode(n) { // a plain function is not effect code (VIP-1, VIP-20)
				report(c, n, EK2001)
				coverExactErrorCodes(c, n.Expression(), 2488, 2504)
			}
			if !forTryOperandType(c, c.GetTypeAtLocation(n.Expression())) {
				report(c, n.Expression(), forTryOperandMessage(c, c.GetTypeAtLocation(n.Expression())))
				// TypeScript reports a nullable operand by name (18047 to 18049) or
				// as an object (2531 to 2533); EK2004 says the same of this operand.
				coverExactErrorCodes(c, n.Expression(), 18047, 18048, 18049, 2531, 2532, 2533)
				coverExactErrorCodes(c, n.Expression(), 2488, 2504)
			}
			var body func(*ast.Node) bool
			body = func(x *ast.Node) bool {
				// A do expression is an invoked arrow, but its jumps still target
				// the function and statements around the for try.
				if ast.IsClassLike(x) {
					for _, expression := range classDefinitionExpressions(x) {
						body(expression)
					}
					return false
				}
				if isFunctionBoundary(x) && !isDoArrow(file, x) {
					if ast.IsFunctionLike(x) {
						if name := x.Name(); name != nil && ast.IsComputedPropertyName(name) {
							body(name)
						}
					}
					return false
				}
				if ast.IsBreakOrContinueStatement(x) && x.Label() != nil {
					target := labeledJumpTarget(file, x)
					own := target != nil && target.Kind == ast.KindLabeledStatement && labeledLoop(target) == n
					if target != nil && !contains(n, target) && !own {
						report(c, x, EK2003)
						// A retained do IIFE is an implementation boundary, not
						// an additional source-function error (VIP-34).
						coverCodes(c, x, 1107)
					}
				}
				// The completion of a do expression is a synthesized return
				// spanning its last expression; only a source return leaves.
				if x.Kind == ast.KindReturnStatement && isReturnKeyword(file, x) {
					report(c, x, EK2002)
					// A head return has no enclosing function body to TypeScript.
					coverCodes(c, x, 1108)
				}
				return x.ForEachChild(body)
			}
			// Chapter 2 forbids these jumps in "head binding initialization or
			// the body": both run inside the per-item callback.
			if init := n.AsForInOrOfStatement().Initializer; init != nil {
				body(init)
			}
			body(n.AsForInOrOfStatement().Statement)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// VIP-20/detail 288 uses ordinary assignability to Stream<any, any, any>.
// Channel extraction alone also admits incomplete objects with a variance
// marker, and cannot recognize any, never or constrained type parameters.
func forTryOperandType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	base := streamInterface(c)
	if base == nil {
		return false
	}
	any := c.GetAnyType()
	return c.IsTypeAssignableTo(t, c.NewTypeReference(base, []*checker.Type{any, any, any}))
}

// forTryOperandMessage picks EK2004's text for a rejected operand of type t.
// An AsyncIterable is checked first, as for await does. A nullable operand
// gets no conversion: neither Stream constructor accepts undefined or null.
func forTryOperandMessage(c *checker.Checker, t *checker.Type) *Message {
	if t == nil {
		return EK2004
	}
	apparent := c.GetApparentType(t)
	has := func(name string) bool {
		return c.GetPropertyOfType(apparent, c.GetPropertyNameForKnownSymbolName(name)) != nil
	}
	switch {
	case has("asyncIterator"):
		return ek2004AsyncIterable
	case c.IsArrayLikeType(t):
		return ek2004Array
	case has("iterator") && !effectYieldAdapter(c, apparent):
		return ek2004Iterable
	}
	return EK2004
}

// effectYieldAdapter reports whether t's [Symbol.iterator] is one of Effect's
// yield* adapters (EffectIterator, OptionIterator, ResultIterator). Iterating
// such a value gives the value itself, not elements, so Stream.fromIterable
// would make a one-element Stream of it.
func effectYieldAdapter(c *checker.Checker, t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if effectYieldAdapter(c, c.GetApparentType(member)) {
				return true
			}
		}
		return false
	}
	method := c.GetTypeOfPropertyOfType(t, c.GetPropertyNameForKnownSymbolName("iterator"))
	if method == nil {
		return false
	}
	for _, signature := range c.GetSignaturesOfType(method, checker.SignatureKindCall) {
		if result := c.GetReturnTypeOfSignature(signature); result != nil && result.Symbol() != nil && declaredInEffect(result.Symbol()) {
			return true
		}
	}
	return false
}

func isReturnKeyword(file *ast.SourceFile, n *ast.Node) bool {
	r := scanner.GetRangeOfTokenAtPosition(file, n.Pos())
	return file.Text()[r.Pos():r.End()] == "return"
}

// labeledJumpTarget returns the statement a labeled break or continue names,
// looking through do expressions and generated concurrent item callbacks.
// Neither introduces a source callable; written callables keep their boundary.
func labeledJumpTarget(file *ast.SourceFile, jump *ast.Node) *ast.Node {
	label := jump.Label().Text()
	for child, n := jump, jump.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) || ast.IsClassElement(n) {
			if n.Name() == child && ast.IsComputedPropertyName(child) || classDecoratorChild(n, child) || isDoArrow(file, n) || isConcurrentBody(n) {
				continue
			}
			return nil
		}
		if isFunctionBoundary(n) && !ast.IsClassLike(n) {
			return nil
		}
		if n.Kind == ast.KindLabeledStatement && n.Label().Text() == label {
			return n
		}
	}
	return nil
}
