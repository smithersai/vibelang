package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A plain return annotation (D67) makes a function plain JavaScript because
// it never fails and never needs a service (D282). `throw` is a typed failure
// everywhere outside a hatch, so a throw that can escape such a function is a
// compile error, as running an Effect in it is: both are EK9203.
//
//	const validate = (value: string): string => {   // EK9203: can fail with Invalid
//	  if (value === "") throw new Invalid({ value })
//	  return value
//	}
//
// The fixes are an Effect contract, `string!Invalid!`, or a hatch, whose
// TypeScript keeps JavaScript's throw. An exception that TypeScript code the
// function calls throws is not a typed failure: it propagates unchanged and
// becomes a defect where it reaches an effectful caller.

// EK9203's texts lead with what the plain function can't do, name the
// function and what it throws or runs, then say why: its return annotation.
// The notes give each way out as code, the likely one first.
var (
	// plainContractThrow: a throw escapes. {0} is the function, {1} what it
	// throws, {2} the annotation.
	plainContractThrow = EK9203.With("{0} can't throw {1}: its return annotation, {2}, makes it a plain function, which never fails.")
	// plainContractRun: a call runs an Effect. {0} is the function, {1} the
	// call, {2} the annotation.
	plainContractRun = EK9203.With("{0} can't run {1}, an Effect: its return annotation, {2}, makes it a plain function, which runs no Effects.")
	// plainContractFailingRun: a call runs an Effect that can fail. {0} is the
	// function, {1} the call, {2} its failures, {3} the annotation.
	plainContractFailingRun = EK9203.With("{0} can't run {1}, an Effect that can fail with {2}: its return annotation, {3}, makes it a plain function, which runs no Effects.")
	// plainContractFailure: a failure escapes from another source. {0} is the
	// function, {1} the failures, {2} the annotation.
	plainContractFailure = EK9203.With("{0} can't fail with {1}: its return annotation, {2}, makes it a plain function, which never fails.")
)

func init() {
	ls.RegisterCodeFixProvider(plainContractFailureFix)
	fileChecks = append(fileChecks, checkPlainCodeThrows)
}

// upperFirst returns a description that starts a message, such as "this
// function" or "the constructor of Port", with its first letter in upper
// case. Code, such as a function's name, keeps its case.
func upperFirst(text string) string {
	if strings.HasPrefix(text, "this ") || strings.HasPrefix(text, "the ") {
		return strings.ToUpper(text[:1]) + text[1:]
	}
	return text
}

// typeListText returns the union of types as TypeScript writes it, or "never"
// for none.
func typeListText(c *checker.Checker, types []*checker.Type) string {
	if len(types) == 0 {
		return "never"
	}
	return c.TypeToString(c.GetUnionType(types))
}

// plainEffectContract returns the Effect contract that makes fn, whose plain
// return annotation is written, an Effect function with the failures and
// requirements its body adds: `number` becomes `number!Invalid!`, or
// `number!!Users` for a body that needs Users.
func (a *analyzer) plainEffectContract(fn *ast.Node, written string) string {
	info := a.flowOf(fn.Body())
	return bangText(written, typeListText(a.checker, info.errors), typeListText(a.checker, info.requirements))
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

// firstEffectRun returns the first call in fn's body that runs an Effect, or
// nil, looking inside throw expressions and do blocks as firstFailureSource
// does.
func (a *analyzer) firstEffectRun(fn *ast.Node) *ast.Node {
	first := a.firstPause(fn)
	if arrow := invokedArrow(first); arrow != nil {
		if inner := a.firstEffectRun(arrow); inner != nil {
			return inner
		}
	}
	return first
}

// invokedArrow returns the arrow that call invokes in place, (() => { … })(),
// the form a throw expression or a do block parses into, or nil.
func invokedArrow(call *ast.Node) *ast.Node {
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 0 {
		return nil
	}
	if callee := ast.SkipParentheses(call.Expression()); callee.Kind == ast.KindArrowFunction && callee.Body() != nil {
		return callee
	}
	return nil
}

// messageCallText returns call's source text for a message, or its callee
// with (…) when the call is long or spans lines.
func messageCallText(file *ast.SourceFile, call *ast.Node) string {
	callee := "this call"
	if ast.IsCallExpression(call) {
		callee = shortText(nodeText(file, call.Expression()), "this call") + "(…)"
	}
	return shortText(nodeText(file, call), callee)
}

// plainFailures returns the expected failures that can escape the body of fn,
// a function with a plain return annotation, as one type, or nil when none
// can.
func (a *analyzer) plainFailures(fn *ast.Node) *checker.Type {
	if fn == nil || fn.Body() == nil || !isLowerable(fn) || !a.hasPlainContract(fn) || fn.Type() == nil {
		return nil
	}
	failures := a.checker.GetUnionType(a.flowOf(fn.Body()).errors)
	if failures.Flags()&checker.TypeFlagsNever != 0 {
		return nil
	}
	return failures
}

// reportFailingPlainContract reports EK9203 at the plain return annotation of
// fn when fn's body can fail, and reports whether it did.
func (a *analyzer) reportFailingPlainContract(fn *ast.Node) bool {
	failures := a.plainFailures(fn)
	if failures == nil {
		return false
	}
	c := a.checker
	file := ast.GetSourceFileOfNode(fn)
	annotation := fn.Type()
	written := scanner.GetTextOfNode(annotation)
	errors := c.TypeToString(failures)
	name := functionDisplayName(fn)
	contract := a.plainEffectContract(fn, written)
	source := a.firstFailureSource(fn)
	switch {
	case source != nil && source.Parent != nil && source.Parent.Kind == ast.KindThrowStatement:
		d := report(c, annotation, plainContractThrow, upperFirst(name), errors, written)
		note(d, "Make it an Effect function: {0}", contract)
		note(d, "Or fail with a defect instead: die({0}), annotated {1}", shortText(nodeText(file, source), "error"), bangText(written))
		note(d, "Or escape to TypeScript: move {0} to a .ts file or a module block, or wrap the throw in sync(() => { … }), annotated {1}", name, bangText(written))
	case source != nil && ast.IsCallExpression(source) && a.runs(source):
		d := report(c, annotation, plainContractFailingRun, upperFirst(name), messageCallText(file, source), errors, written)
		note(d, "Make it an Effect function: {0}", contract)
		note(d, "Or remove the annotation to infer the whole contract.")
	default:
		d := report(c, annotation, plainContractFailure, upperFirst(name), errors, written)
		note(d, "Make it an Effect function: {0}", contract)
		note(d, "Or catch the failure inside {0}.", name)
	}
	return true
}

// reportRunningPlainContract reports EK9203 at the plain return annotation of
// fn, whose body runs an Effect but cannot fail.
func (a *analyzer) reportRunningPlainContract(fn *ast.Node) {
	c := a.checker
	file := ast.GetSourceFileOfNode(fn)
	annotation := fn.Type()
	written := scanner.GetTextOfNode(annotation)
	name := functionDisplayName(fn)
	var d *ast.Diagnostic
	if call := a.firstEffectRun(fn); call != nil {
		d = report(c, annotation, plainContractRun, upperFirst(name), messageCallText(file, call), written)
	} else {
		d = report(c, annotation, EK9203, upperFirst(name), written)
	}
	note(d, "Make it an Effect function: {0}", a.plainEffectContract(fn, written))
	note(d, "Or remove the annotation to infer the whole contract.")
}

// plainContractFailureFix writes the Effect contract that EK9203 offers: `:
// string` becomes `: string!Invalid!` for a body that can fail, and `:
// number!!` for one that runs an Effect.
var plainContractFailureFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK9203.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		annotation := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return node.Parent != nil && isLowerable(node.Parent) && node.Parent.Type() == node
		})
		if annotation == nil {
			return nil, nil
		}
		fn := annotation.Parent
		if isPlainGenerator(fn) || fn.Body() == nil {
			return nil, nil // a generator's way out is a producer or a module block
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		contract := analyzerFor(c).plainEffectContract(fn, scanner.GetTextOfNode(annotation))
		return []*ls.CodeAction{{
			Description: "Write " + contract,
			Changes:     replaceRange(fix, nodeStart(fix.SourceFile, annotation), annotation.End(), contract),
		}}, nil
	},
}

// failingCallback is EK4301's text for a lambda that can fail where a plain
// function is expected. {0} is the failures, {1} the callee.
var failingCallback = EK4301.With("This callback can't throw {0}: {1} calls it synchronously, as a plain function, which never fails.")

// failingMethod is EK4301's text for a method that can fail and implements a
// plain-function member. {0} is the method, {1} the failures, {2} the member's
// owner.
var failingMethod = EK4301.With("{0} can't throw {1}: {2} declares it as a plain function, which never fails.")

// escapingFailures returns the expected failures that can escape fn's body,
// as one type, or nil when none can.
func (a *analyzer) escapingFailures(fn *ast.Node) *checker.Type {
	if fn == nil || fn.Body() == nil {
		return nil
	}
	failures := a.checker.GetUnionType(a.flowOf(fn.Body()).errors)
	if failures.Flags()&checker.TypeFlagsNever != 0 {
		return nil
	}
	return failures
}

// reportFailingCallback reports EK4301 at fn, a lambda where a plain function
// is expected, as an argument of call or, when call is nil, through another
// contextual type, when it can fail, and reports whether it did.
func (a *analyzer) reportFailingCallback(file *ast.SourceFile, fn *ast.Node, call *ast.Node) bool {
	failures := a.escapingFailures(fn)
	if failures == nil {
		return false
	}
	c := a.checker
	d := report(c, fn, failingCallback, c.TypeToString(failures), calleeName(c, file, call))
	if call != nil {
		note(d, "Use {0} or a for...of loop.", forEachFix(c, file, call, fn))
	}
	note(d, "Or catch the failure inside the callback.")
	return true
}

// reportFailingMethod reports EK4301 at the name of fn, a method that
// implements owner's plain-function member, when it can fail. A method with a
// plain return annotation has EK9203 instead.
func (a *analyzer) reportFailingMethod(file *ast.SourceFile, fn *ast.Node, owner string) {
	if fn.Type() != nil {
		return
	}
	if failures := a.escapingFailures(fn); failures != nil {
		d := report(a.checker, fn.Name(), failingMethod, nodeText(file, fn.Name()), a.checker.TypeToString(failures), owner)
		note(d, "Catch the failure inside {0}, or check before building the object.", nodeText(file, fn.Name()))
	}
}

// reportFactoryFailures reports EK2115 at each throw that can end fn, a D269
// factory: its body runs as plain JavaScript when fn is called, and a plain
// function never fails (D282). The returned program fails instead.
func (a *analyzer) reportFactoryFailures(file *ast.SourceFile, fn *ast.Node, name string) {
	forEachEscapingThrow(fn, func(throw *ast.Node) {
		text := nodeText(file, throw)
		d := report(a.checker, throw, EK2115.With("{0} returns a program, so its body runs as plain JavaScript when {0} is called, and can't throw."), name)
		note(d, "Fail when the program runs instead: return () => { {0} }.", text)
	})
}

// forEachEscapingThrow calls cb with each throw statement in fn's own body
// that no try block of fn with a catch clause encloses.
func forEachEscapingThrow(fn *ast.Node, cb func(throw *ast.Node)) {
	if fn.Body() != nil {
		forEachEscapingThrowIn(fn.Body(), cb)
	}
}

// forEachEscapingThrowIn calls cb with each throw statement in root, outside
// the functions and classes nested in it, that no try block in root with a
// catch clause encloses.
func forEachEscapingThrowIn(root *ast.Node, cb func(throw *ast.Node)) {
	var visit func(n *ast.Node, caught bool) bool
	visit = func(n *ast.Node, caught bool) bool {
		switch {
		case isFunctionBoundary(n):
			return false
		case n.Kind == ast.KindThrowStatement && !caught:
			cb(n)
			return false
		case n.Kind == ast.KindTryStatement:
			try := n.AsTryStatement()
			visit(try.TryBlock, caught || catches(n))
			if try.CatchClause != nil {
				visit(try.CatchClause, caught)
			}
			if try.FinallyBlock != nil {
				visit(try.FinallyBlock, caught)
			}
			return false
		}
		n.ForEachChild(func(child *ast.Node) bool { return visit(child, caught) })
		return false
	}
	visit(root, false /*caught*/)
}

// A constructor, an accessor and a class static block run as plain
// JavaScript wherever they stand, as a module's top level does: none of them
// is an Effect, so none of them can fail (D282). A throw is a typed failure
// everywhere outside a hatch or a module declaration, so one that can escape
// such code is a compile error, as it is in a function with a plain return
// annotation: EK9203, and EK1001 at a module's top level, where running a
// program is EK1001 too.
//
//	error Invalid { value: number }
//	class Port {
//	  constructor(readonly value: number) {
//	    if (value < 0) throw new Invalid({ value })   // EK9203
//	  }
//	}
//
// A throw that the code's own catch handles stays inside it.

// plainCodeFailure is EK9203's text for a throw that can escape a constructor,
// an accessor or a static block. {0} names the code, {1} is what it throws,
// and {2} the kind of code.
var plainCodeFailure = EK9203.With("{0} can't throw {1}: {2} runs as plain JavaScript, which never fails.")

// topLevelFailure is EK1001's text for a throw that can escape a module's top
// level. {0} is what it throws.
var topLevelFailure = EK1001.With("A module's top level can't throw {0}: it runs as plain JavaScript, which never fails.")

// topLevelBlockNote is EK1001's fix for a block or statement at a module's
// top level that runs a program.
const topLevelBlockNote = "Move it into a function that a program runs, such as main."

// moduleThrowNote names the escape for code that must throw a JavaScript
// exception, such as a test's throwing getter.
const moduleThrowNote = "Or escape to TypeScript, whose throw is JavaScript's: move the code to a module block or a .ts file."

// checkPlainCodeThrows reports each throw that can escape a module's top level
// (EK1001) or a constructor, accessor or static block (EK9203) in file.
func checkPlainCodeThrows(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	forEachEscapingThrowIn(file.AsNode(), func(throw *ast.Node) {
		d := report(c, throw, topLevelFailure, c.TypeToString(a.thrownType(throw)))
		note(d, "Throw inside a function that a program runs, such as main.")
		note(d, moduleThrowNote)
	})
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isHatchArgument(node) {
			return false // a hatch's function is TypeScript (D148)
		}
		body := node.Body()
		if node.Kind == ast.KindClassStaticBlockDeclaration {
			body = node.AsClassStaticBlockDeclaration().Body // a static block has no Body()
		}
		switch node.Kind {
		case ast.KindConstructor, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindClassStaticBlockDeclaration:
			if body != nil {
				forEachEscapingThrowIn(body, func(throw *ast.Node) {
					failure := c.TypeToString(a.thrownType(throw))
					kind := map[ast.Kind]string{ast.KindConstructor: "a constructor", ast.KindClassStaticBlockDeclaration: "a static block"}[node.Kind]
					if kind == "" {
						kind = "an accessor"
					}
					d := report(c, throw, plainCodeFailure, upperFirst(plainCodeName(node)), failure, kind)
					switch node.Kind {
					case ast.KindConstructor:
						if class := node.Parent; class != nil && class.Name() != nil {
							note(d, "Check before constructing, in an Effect function that can fail with {0}, such as static make(…): {1}", failure, bangText(nodeText(file, class.Name()), failure))
						} else {
							note(d, "Check before constructing, in an Effect function that can fail with {0}.", failure)
						}
					case ast.KindClassStaticBlockDeclaration:
						note(d, "Throw inside a function that a program runs, such as main.")
					default:
						note(d, "Write a method instead: an Effect method can fail with {0}.", failure)
					}
					note(d, moduleThrowNote)
				})
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// plainCodeName names node, a constructor, accessor or class static block, in
// a diagnostic: "the constructor of Port", "get value", "the static block of
// Port".
func plainCodeName(node *ast.Node) string {
	file := ast.GetSourceFileOfNode(node)
	switch node.Kind {
	case ast.KindGetAccessor:
		return "get " + nodeText(file, node.Name())
	case ast.KindSetAccessor:
		return "set " + nodeText(file, node.Name())
	}
	what := "the constructor"
	if node.Kind == ast.KindClassStaticBlockDeclaration {
		what = "the static block"
	}
	if class := node.Parent; class != nil && class.Name() != nil {
		return what + " of " + nodeText(file, class.Name())
	}
	return what + " of this class"
}

// inCatchingTry reports whether a try block with a catch clause in the
// function that holds node encloses node. In a plain function only there is
// a trusted call's listed exception a typed failure, which the catch receives
// (D54); elsewhere it propagates unchanged, as JavaScript's (D282).
func inCatchingTry(node *ast.Node) bool {
	for n := node; n.Parent != nil && !isFunctionBoundary(n.Parent); n = n.Parent {
		if parent := n.Parent; parent.Kind == ast.KindTryStatement && parent.AsTryStatement().TryBlock == n && catches(parent) {
			return true
		}
	}
	return false
}
