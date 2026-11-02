package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// A generator with a JavaScript iterator return annotation (D271) compiles to
// the generator TypeScript would write. It follows D282 like any plain
// function (D296): its throw is a typed failure, so one that can escape it is
// a compile error, and its catch receives typed failures only, so an
// exception that its caller passes in with generator.throw() passes through.
//
//	function* steps(): Generator<number> {   // EK9203: can fail with Invalid
//	  throw new Invalid()
//	}
//
// Code that must speak a JavaScript protocol by throwing, such as a coroutine
// driven by generator.throw(), belongs in a module block (D283) or a .ts file.

// plainGeneratorFailure is EK9203's text for a generator with a JavaScript
// iterator annotation whose body can fail. {0} is the generator, {1} the
// failures that can escape it, and {2} the annotation.
var plainGeneratorFailure = EK9203.With("{0} can't throw {1}: its return annotation, {2}, makes it a JavaScript generator, which never fails.")

func init() {
	fileChecks = append(fileChecks, checkPlainGenerators)
}

// isPlainGenerator reports whether fn is a generator function in a .vibe file,
// outside a hatch, whose return annotation is a JavaScript iterator type
// (D271).
func isPlainGenerator(fn *ast.Node) bool {
	if fn == nil || fn.Kind != ast.KindFunctionDeclaration && fn.Kind != ast.KindFunctionExpression || fn.Body() == nil {
		return false
	}
	if ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator == 0 {
		return false
	}
	return isVibeLangFile(ast.GetSourceFileOfNode(fn)) && !inHatch(fn) && vibelangmapper.HasJavaScriptIteratorReturn(fn)
}

// inPlainGeneratorBody reports whether node is in the body of a plain
// generator, and not in a function nested there.
func inPlainGeneratorBody(node *ast.Node) bool {
	for n := node; n.Parent != nil; n = n.Parent {
		if isHatchArgument(n) {
			return false
		}
		if fn := n.Parent; isFunctionBoundary(fn) {
			return n == fn.Body() && isPlainGenerator(fn)
		}
	}
	return false
}

// plainGeneratorCall is EK9203's text for a call that runs an Effect in a
// JavaScript generator. {0} is the call, {1} the generator.
var plainGeneratorCall = EK9203.With("{0} runs an Effect, but {1} is a JavaScript generator, whose body is plain code and cannot run one.")

// isGeneratorMethod reports whether fn is a generator method of a class or an
// object literal in a .vibe file, *name() { … }, which is a JavaScript
// generator, as in TypeScript, and which no annotation is required to type
// (Chapter 8).
func isGeneratorMethod(fn *ast.Node) bool {
	return fn.Kind == ast.KindMethodDeclaration && fn.Body() != nil && ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator != 0 &&
		isVibeLangFile(ast.GetSourceFileOfNode(fn)) && !inHatch(fn)
}

// checkPlainGenerators reports EK9203 at the annotation of each plain
// generator whose body can fail (D296), and at each call that runs an Effect
// in the body of a generator method, which is plain code (Chapter 8): the
// call returned its program unrun, and the method yielded it. A call that
// yield* delegates to is the generator's protocol, as in a coroutine that
// yields programs, and a plain generator's annotation says what it yields.
func checkPlainGenerators(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if isGeneratorMethod(node) {
			name := functionDisplayName(node)
			if n := node.Name(); n != nil && ast.IsComputedPropertyName(n) {
				name = nodeText(file, n) // [Symbol.iterator]
			}
			a.forEachRunningCallInBody(node, func(call *ast.Node) bool {
				if !isDelegatedOperand(call) && a.performs(call) {
					d := report(c, call, plainGeneratorCall, nodeText(file, call), name)
					note(d, "Run it before the generator and pass its value in, or yield a program, () => {0}.", nodeText(file, call))
				}
				return false
			})
		}
		if isPlainGenerator(node) {
			// Its calls are TypeScript's and run nothing, so only its throws can fail it.
			var thrown []*checker.Type
			forEachEscapingThrow(node, func(throw *ast.Node) { thrown = append(thrown, a.thrownType(throw)) })
			if len(thrown) > 0 {
				d := report(c, node.Type(), plainGeneratorFailure, upperFirst(functionDisplayName(node)), c.TypeToString(c.GetUnionType(thrown)), nodeText(file, node.Type()))
				note(d, "Remove the annotation to make it a producer, a Stream whose throw fails the Stream.")
				note(d, "Or escape to TypeScript, whose throw is JavaScript's: move {0} to a module block or a .ts file.", functionDisplayName(node))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isDelegatedOperand reports whether call is the operand of yield*, which
// delegates to the iterator the call returns.
func isDelegatedOperand(call *ast.Node) bool {
	parent := ast.WalkUpParenthesizedExpressions(call.Parent)
	return parent != nil && parent.Kind == ast.KindYieldExpression && parent.AsYieldExpression().AsteriskToken != nil
}
