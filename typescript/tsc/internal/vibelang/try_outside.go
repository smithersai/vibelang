package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// try runs an Effect only in effect code (VIP-1, VIP-5): the body of the
// innermost enclosing function, when that function is marked effect, is an
// effect block, or is a producer. A plain function nested in an effect
// function is plain, as an arrow nested in an async function cannot await,
// and a parameter default runs when the function is called, outside its
// Effect. Anywhere else try is EK0501. Its quick fix marks the function
// effect; vibelang --fix leaves it alone, because the callers of a marked
// function get its Effect unrun instead of its value.

// EK0501: try outside effect code. {0} says where the try stands.
var EK0501 = message(501, errorCategory, "try runs an Effect only in effect code, but {0}.")

func init() {
	registry[EK0501.Code] = EK0501
	fileChecks = append(fileChecks, checkTriesOutsideEffectCode)
	tsFormRules[EK0501.Code] = &tsFormRule{
		message:   EK0501,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      markEffectRewrite,
		diagnosed: isTry,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0501.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// isTry reports whether node is a try: a call the parser flagged
// NodeFlagsVibeLangTry, or $try(e).
func isTry(node *ast.Node) bool {
	return triedFlag(node) && isInvocation(node) || isTryCall(node)
}

// triedFlag reports whether the parser flagged node NodeFlagsVibeLangTry,
// or flagged the parentheses that hold only node: try (f()) flags (f()),
// whose range starts at try, and runs the call f() as try f() does.
func triedFlag(node *ast.Node) bool {
	for n := node; n != nil; n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return true
		}
		if n.Parent == nil || !ast.IsParenthesizedExpression(n.Parent) {
			return false
		}
	}
	return false
}

// effectCodeOwner returns the function whose body holds node, or nil when
// node stands outside any function body: at the top level of a module, in a
// class field or static block, or in a parameter list.
func effectCodeOwner(node *ast.Node) *ast.Node {
	child := node
	for n := node.Parent; n != nil; child, n = n, n.Parent {
		if !isFunctionBoundary(n) || isCalledInPlace(n) || isCatchLeftFunction(n) {
			continue // an arrow the parser calls in place, or a catch expression's left side, has the code around it (markedForm)
		}
		if ast.IsFunctionLike(n) && n.Body() != nil && n.Body() == child {
			return n
		}
		return nil
	}
	return nil
}

// inEffectCode reports whether node stands in effect code, where try runs
// an Effect.
func inEffectCode(node *ast.Node) bool {
	fn := effectCodeOwner(node)
	return fn != nil && (isMarkedEffect(fn) || isProducer(fn) || isProgramArrow(fn) && markedForm(fn) != formNone)
}

// checkTriesOutsideEffectCode reports EK0501 at each try of file outside
// effect code.
func checkTriesOutsideEffectCode(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		// try.all, try.race, try.any and try.allSettled follow the same rule
		// (chapter 2: EK0501).
		if (isTry(node) || tryOperationName(node) != "") && !inHatch(node) && !inEffectCode(node) {
			reportTryOutsideEffectCode(c, file, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func reportTryOutsideEffectCode(c *checker.Checker, file *ast.SourceFile, node *ast.Node) {
	fn := effectCodeOwner(node)
	plain := plainCodeAround(node)
	var where string
	switch {
	case plain != nil:
		reportTryInPlainCode(c, file, node, plain)
		return
	case fn == nil && enclosingFunction(node) == nil && ast.FindAncestor(node, ast.IsClassLike) == nil:
		where = "this try is at the top level of the module"
	case fn == nil:
		where = "this try is outside any function body"
	case ast.HasSyntacticModifier(fn, ast.ModifierFlagsAsync):
		where = "it is in an async function, which waits for Promises with await"
	case fn.Name() != nil && ast.IsIdentifier(fn.Name()):
		where = fn.Name().Text() + " is a plain function"
	default:
		where = "it is in a plain function"
	}
	d := reportAt(c, file, tsFormSpan(file, node), EK0501, where)
	if rewrite := markEffectRewrite(c, file, node); rewrite.fixable() {
		note(d, "Mark the function effect: {0}. Its callers then get its Effect unrun. Its quick fix writes effect.", rewrite.description)
	} else if fn == nil {
		note(d, "Run it inside an effect function, such as export effect function main().")
	}
	cover(c, node)
}

// plainCodeAround returns the code around node that stays plain JavaScript
// and can't be marked effect (VIP-1): a class field's initializer, a
// parameter default, a class static block, a constructor or an accessor. It
// returns nil anywhere else, including inside a function nested there, whose
// own marker decides.
func plainCodeAround(node *ast.Node) *ast.Node {
	child := node
	for n := node.Parent; n != nil; child, n = n, n.Parent {
		switch n.Kind {
		case ast.KindPropertyDeclaration, ast.KindParameter:
			if n.Initializer() == child {
				return n
			}
		case ast.KindClassStaticBlockDeclaration, ast.KindConstructor, ast.KindGetAccessor, ast.KindSetAccessor:
			return n
		}
		if isFunctionBoundary(n) && !isCalledInPlace(n) && !isCatchLeftFunction(n) {
			return nil
		}
	}
	return nil
}

// reportTryInPlainCode reports EK0501 at node, a try in plain, the plain code
// around it that plainCodeAround found, with the change that runs it.
func reportTryInPlainCode(c *checker.Checker, file *ast.SourceFile, node *ast.Node, plain *ast.Node) {
	span := tsFormSpan(file, node)
	switch plain.Kind {
	case ast.KindPropertyDeclaration:
		d := reportAt(c, file, span, EK0501, "a class field's initializer is plain JavaScript")
		note(d, "Run it in an effect function and pass the value to the constructor, or make {0} an effect method.", nodeText(file, plain.Name()))
	case ast.KindParameter:
		fn := plain.Parent
		owner := "the function"
		if fn.Name() != nil && ast.IsIdentifier(fn.Name()) {
			owner = fn.Name().Text()
		}
		d := reportAt(c, file, span, EK0501, "a parameter default runs when "+owner+" is called, outside any Effect")
		note(d, "Make {0} optional and run the default in the body of an effect function: {0} ?? ({1}).", nodeText(file, plain.Name()), nodeText(file, plain.Initializer()))
	case ast.KindGetAccessor, ast.KindSetAccessor:
		d := reportAt(c, file, span, EK0501, plainCodeName(plain)+" is an accessor, which can't be an effect function")
		note(d, "Write an effect method instead: effect {0}() { … }.", nodeText(file, plain.Name()))
	case ast.KindConstructor:
		d := reportAt(c, file, span, EK0501, plainCodeName(plain)+" is plain JavaScript, and can't be an effect function")
		note(d, "Run it in an effect function before constructing, and pass the result to the constructor.")
	default:
		d := reportAt(c, file, span, EK0501, plainCodeName(plain)+" is plain JavaScript")
		note(d, "Run it inside an effect function, such as export effect function main().")
	}
	cover(c, node)
}

// markEffectRewrite plans the EK0501 fix at a try: effect written before the
// function that holds it, where TypeScript allows async. A function that is
// async, a generator, a constructor or an accessor has none.
func markEffectRewrite(_ *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
	fn := effectCodeOwner(at)
	if fn == nil {
		return &formRewrite{}
	}
	edit, description, ok := effectMarkerEdit(file, fn)
	if !ok {
		return &formRewrite{}
	}
	return &formRewrite{edits: []sourceEdit{edit}, description: description}
}

// effectMarkerEdit returns the edit that writes effect before fn, an arrow,
// function or method, where TypeScript allows async, and the form it writes.
// A function that is async, a generator, a constructor or an accessor has none.
func effectMarkerEdit(file *ast.SourceFile, fn *ast.Node) (sourceEdit, string, bool) {
	if ast.GetFunctionFlags(fn)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0 {
		return sourceEdit{}, "", false
	}
	switch fn.Kind {
	case ast.KindArrowFunction:
		start := nodeStart(file, fn)
		return sourceEdit{start, start, "effect "}, "effect (…) =>", true
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression:
		from := nodeStart(file, fn)
		loc := functionWord.FindStringIndex(file.Text()[from:fn.End()])
		if loc == nil {
			return sourceEdit{}, "", false
		}
		name := "(…)"
		if fn.Name() != nil {
			name = fn.Name().Text() + "(…)"
		}
		return sourceEdit{from + loc[0], from + loc[0], "effect "}, "effect function " + name, true
	case ast.KindMethodDeclaration:
		start := nodeStart(file, fn.Name())
		return sourceEdit{start, start, "effect "}, "effect " + nodeText(file, fn.Name()) + "(…)", true // a name may be computed
	}
	return sourceEdit{}, "", false
}
