package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// An Effect never satisfies a plain function type (Chapter 14, D430). TypeScript
// lets () => Effect<void> stand where () => void is expected, and a caller of
// the plain type drops the program unrun. So wherever a .vibe file gives a
// value a declared type, a call signature or method of that type whose return
// type is neither definitely an Effect nor a union with such a member is not
// matched by a source that returns an Effect, or may (D512):
//
//	const cb: (n: number) => void = logged      // logged is an Effect function: EK4301
//	const r: Resettable = new Counter()         // Counter's reset() is an Effect method: EK4301
//	runAll(fs)                                  // fs holds Effect functions: EK4301
//
// A source function value is read by its type (D492, D511). A member that a
// class, an interface, or a type literal declares is read by that declaration,
// with its own type parameters left uninstantiated, a VibeLang method by its
// form (D485). Function literals take their destination's form (rule F), so
// they are checked where they are written, not here. Function, which has no
// call signature, is a plain function type here too (D513).

func init() {
	fileChecks = append(fileChecks, checkPlainTargets)
}

// EK4301's texts for a value that returns an Effect, or may, where its type
// declares a plain function: a function, an object's method, and a container
// of either.
var (
	erasedFunction     = EK4301.With("{0} returns an Effect, or may, but {1} is a plain function type, whose callers drop the program unrun.")
	erasedMember       = EK4301.With("The method {1} of {0} returns an Effect, or may, but {2} declares {1} a plain function, whose callers drop the program unrun.")
	erasedHeldFunction = EK4301.With("{0} holds functions that return an Effect, or may, but {1} is a plain function type, whose callers drop the program unrun.")
	erasedHeldMember   = EK4301.With("{0} holds values whose method {1} returns an Effect, or may, but {2} declares {1} a plain function, whose callers drop the program unrun.")
)

// erasedFix is the note on each: the source's annotation or the
// destination's type writes the form.
const erasedFix = "Give the function a plain return annotation, such as (): void, to make it plain, or declare the destination's return type an Effect, such as () => void!!."

func checkPlainTargets(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if inHatch(node) {
			return false
		}
		switch {
		case ast.IsVariableDeclaration(node) && node.Type() != nil && node.Initializer() != nil:
			a.checkPlainTarget(file, node.Initializer(), c.GetTypeFromTypeNode(node.Type()))
		case ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && !ast.IsObjectLiteralExpression(node.AsBinaryExpression().Left) && !ast.IsArrayLiteralExpression(node.AsBinaryExpression().Left):
			a.checkPlainTarget(file, node.AsBinaryExpression().Right, c.GetTypeAtLocation(node.AsBinaryExpression().Left))
		case ast.IsReturnStatement(node) && node.Expression() != nil:
			if fn := ast.GetContainingFunction(node); fn != nil && fn.Type() != nil && !isInferredReturnAnnotation(fn.Type()) && isLowerable(fn) {
				if t := c.GetTypeFromTypeNode(fn.Type()); !isEffectType(c, t) {
					a.checkPlainTarget(file, node.Expression(), t)
				}
			}
		case ast.IsCallExpression(node) || ast.IsNewExpression(node):
			if signature := c.GetResolvedSignature(node); signature != nil {
				for i, argument := range node.Arguments() {
					if ast.IsSpreadElement(argument) || i >= len(signature.Parameters()) && !signature.HasRestParameter() {
						continue
					}
					target := c.GetTypeAtPosition(signature, i)
					if target == c.GetGlobalFunctionType() && signature.Declaration() != nil && isLibFile(c, ast.GetSourceFileOfNode(signature.Declaration())) {
						continue // Reflect.construct and Reflect.apply return what the function returns; they drop nothing
					}
					a.checkPlainTarget(file, argument, target)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkPlainTarget reports EK4301 when the value of source, given the type
// target, returns an Effect where target declares a plain function.
func (a *analyzer) checkPlainTarget(file *ast.SourceFile, source *ast.Node, target *checker.Type) {
	c := a.checker
	inner := ast.SkipParentheses(source)
	if target == nil || inner.Kind == ast.KindArrowFunction || inner.Kind == ast.KindFunctionExpression {
		return // a literal takes its destination's form (rule F)
	}
	t := c.GetTypeAtLocation(source)
	if t == nil || !c.IsTypeAssignableTo(t, target) {
		return // TypeScript reports the mismatch
	}
	e := a.erasure(t, target, 0)
	if e.owner == nil {
		return
	}
	text, owner := nodeText(file, source), c.TypeToString(e.owner)
	if label := stableFactoryResultLabel(file, source); label != "" {
		text = label
	}
	var d *ast.Diagnostic
	switch {
	case e.member == "" && !e.held:
		d = report(c, source, erasedFunction, text, owner)
	case e.member == "":
		d = report(c, source, erasedHeldFunction, text, owner)
	case !e.held:
		d = report(c, source, erasedMember, text, e.member, owner)
	default:
		d = report(c, source, erasedHeldMember, text, e.member, owner)
	}
	note(d, erasedFix)
}

// erased is where a value puts an Effect where its type declares a plain
// function: owner, the type that declares the function, nil for none; member,
// the function's name when it is a member; and held, whether the value holds
// it as an element.
type erased struct {
	owner  *checker.Type
	member string
	held   bool
}

// erasure finds where source, assigned to target, puts an Effect where target
// declares a plain function.
func (a *analyzer) erasure(source, target *checker.Type, depth int) erased {
	c := a.checker
	if source == nil || target == nil || depth > 3 || source == target {
		return erased{}
	}
	if target.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 || isEffectType(c, target) || isEffectType(c, source) {
		return erased{}
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range source.Types() {
			if e := a.erasure(member, target, depth); e.owner != nil {
				return e
			}
		}
		return erased{}
	}
	if target.Flags()&checker.TypeFlagsUnion != 0 {
		// The source fits some member of the union. A callable member that
		// takes it as an Effect function keeps it (D39); a plain callable
		// member it fits reaches it, even beside a data member (D430, D513).
		// Otherwise it erases an Effect only when every member that could
		// hold it does.
		var found, called erased
		kept := false
		for _, member := range target.Types() {
			if member.Flags()&(checker.TypeFlagsNullable|checker.TypeFlagsVoid) != 0 || !c.IsTypeAssignableTo(source, member) {
				continue
			}
			e := a.erasure(source, member, depth)
			switch {
			case e.owner == nil && a.isCallableTarget(member):
				return erased{}
			case e.owner == nil:
				kept = true
			case a.isCallableTarget(member):
				called = e
			default:
				found = e
			}
		}
		if called.owner != nil {
			return called
		}
		if kept {
			return erased{}
		}
		return found
	}
	if a.isCallableTarget(target) {
		if a.isPlainFunctionType(target) && mayReturnEffect(c, source) {
			return erased{owner: target}
		}
		return erased{}
	}
	if elements := c.GetIndexTypeOfType(target, c.GetNumberType()); elements != nil {
		if held := c.GetIndexTypeOfType(source, c.GetNumberType()); held != nil {
			if e := a.erasure(held, elements, depth+1); e.owner != nil {
				e.held = true
				return e
			}
		}
		return erased{}
	}
	if target.Flags()&checker.TypeFlagsObject == 0 || source.Flags()&checker.TypeFlagsObject == 0 {
		return erased{}
	}
	for _, property := range c.GetPropertiesOfType(target) {
		held := c.GetPropertyOfType(source, property.Name())
		if held == nil || held == property || held.ValueDeclaration() != nil && held.ValueDeclaration() == property.ValueDeclaration() {
			continue
		}
		declared := a.declaredPropertyType(property)
		if declared == nil {
			continue
		}
		if len(c.GetSignaturesOfType(declared, checker.SignatureKindCall)) > 0 {
			if a.isPlainFunctionType(declared) && a.memberMayReturnEffect(held) {
				return erased{owner: target, member: property.Name()}
			}
			continue
		}
		if e := a.erasure(c.GetTypeOfSymbol(held), c.GetTypeOfSymbol(property), depth+1); e.owner != nil {
			return e
		}
	}
	return erased{}
}

// isCallableTarget reports whether target takes a function and calls it: it
// has a call signature, or it is Function, which has none but takes any
// function, as React's useCallback<T extends Function> does (D513).
func (a *analyzer) isCallableTarget(target *checker.Type) bool {
	return target == a.checker.GetGlobalFunctionType() || len(a.checker.GetSignaturesOfType(target, checker.SignatureKindCall)) > 0
}

// isPlainFunctionType reports whether every call signature of t returns a
// type that is neither definitely an Effect nor a union with such a member.
func (a *analyzer) isPlainFunctionType(t *checker.Type) bool {
	e := a.classify([]*checker.Type{t})
	return e.plainFn && !e.effectFn && !e.program
}

// declaredPropertyType returns the type of property as its declaration in a
// class, an interface, or a type literal gives it, with that declaration's
// type parameters uninstantiated (D485), else its type.
func (a *analyzer) declaredPropertyType(property *ast.Symbol) *checker.Type {
	c := a.checker
	if d := property.ValueDeclaration(); d != nil && d.Parent != nil && d.Symbol() != nil {
		switch d.Parent.Kind {
		case ast.KindClassDeclaration, ast.KindClassExpression, ast.KindInterfaceDeclaration, ast.KindTypeLiteral:
			return c.GetTypeOfSymbol(d.Symbol())
		}
	}
	return c.GetTypeOfSymbol(property)
}

// memberMayReturnEffect reports whether held, a source member, returns an
// Effect or may: a VibeLang method or function literal by its form, a member
// a class, an interface, or a type literal declares by its declaration, and
// any other by its type (D485).
func (a *analyzer) memberMayReturnEffect(held *ast.Symbol) bool {
	if d := held.ValueDeclaration(); d != nil {
		if ast.IsPropertyAssignment(d) && d.Initializer() != nil {
			if fn := ast.SkipParentheses(d.Initializer()); isLambda(fn) {
				return a.isEffect(fn)
			}
		}
		if isWrittenForm(d) {
			return a.isEffect(d)
		}
	}
	return mayReturnEffect(a.checker, a.declaredPropertyType(held))
}
