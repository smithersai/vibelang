package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func init() { fileChecks = append(fileChecks, checkNeverStored) }

// checkNeverStored reports EK1012 where a call that runs never succeeds and
// what it would give is stored: a variable's initializer, an object literal's
// field, an array literal's element, or the right side of an assignment. A
// call runs where it stands (D147), and only a declared Effect type holds a
// program instead (D262, D265, D269), so the binding, field or element never
// holds a value: `const missing = Effect.fail(new Missing())` fails the
// function at the const, and `{ follow: followUntil() }` runs the loop while
// the object is built, where Effect TypeScript stores both programs to run
// later. A stored value that can never exist is no use, so the warning names
// the spellings that say what was meant: store a function, or the declared
// Effect type, to keep the program; a statement or a throw to run it here.
func checkNeverStored(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration {
			return false // TypeScript (D283)
		}
		if ast.IsCallExpression(node) && inLowerableBody(node) && !inHatch(node) {
			checkNeverStoredCall(c, a, file, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkNeverStoredCall reports EK1012 at call when it is stored, runs, and
// never succeeds.
func checkNeverStoredCall(c *checker.Checker, a *analyzer, file *ast.SourceFile, call *ast.Node) {
	target, name, kind := storedAt(call)
	if kind == storedNot || !a.runs(call) || a.isByName(call) {
		return
	}
	// A call the parser wrote for a form, such as $await for `await x`, has
	// its own diagnostics, and resume's result is the handle's (EK2110).
	if isHelperCall(call) || resumeKind(c, call) != "" {
		return
	}
	if c.GetTypeAtLocation(call).Flags()&checker.TypeFlagsNever == 0 {
		return
	}
	sig := c.GetResolvedSignature(call)
	if sig == nil {
		return
	}
	program := c.GetReturnTypeOfSignature(sig)
	if !isEffectType(c, program) {
		return // a plain function that returns never, such as an assertion, throws as TypeScript does
	}
	text := expressionText(file, call.Expression()) + core.IfElse(len(call.Arguments()) == 0, "()", "(…)")
	d := report(c, call, EK1012, text, target)
	switch typeText := bangTypes(c.TypeToString(program)); kind {
	case storedConst:
		note(d, "To keep the program, write its type, const {0}: {1} = …, or store a function: () => {2}. To run it here, write it as a statement.", name, typeText, text)
	case storedField:
		note(d, "To keep the program, declare the object's type with {0}: {1}, or store a function: {0}: () => {2}. To run it here, write it as a statement.", name, typeText, text)
	default:
		note(d, "To keep the program, store a function: () => {0}. To run it here, write it as a statement.", text)
	}
}

// storedKind is where a call's value is stored, for EK1012.
type storedKind uint8

const (
	storedNot   storedKind = iota // not stored
	storedConst                   // a const's initializer, which its Effect type holds (D269)
	storedField                   // an object literal's field, which a declared Effect type holds (D265)
	storedOther                   // a let or var, an array element, or an assignment
)

// storedAt returns what stores call's value, as EK1012 names it, the name of
// the binding or field, and where it is stored.
func storedAt(call *ast.Node) (target string, name string, kind storedKind) {
	value := call
	for ast.IsParenthesizedExpression(value.Parent) {
		value = value.Parent
	}
	parent := value.Parent
	switch {
	case ast.IsVariableDeclaration(parent) && parent.Initializer() == value:
		if !ast.IsIdentifier(parent.Name()) {
			return "this binding", "", storedOther
		}
		name := parent.Name().Text()
		if list := parent.Parent; list != nil && list.Kind == ast.KindVariableDeclarationList && list.Flags&ast.NodeFlagsConst != 0 {
			return name, name, storedConst
		}
		return name, name, storedOther
	case ast.IsPropertyAssignment(parent) && parent.Initializer() == value:
		if field := parent.Name(); ast.IsIdentifier(field) {
			return "the field " + field.Text(), field.Text(), storedField
		}
		return "this field", "", storedOther
	case ast.IsArrayLiteralExpression(parent):
		return "this element", "", storedOther
	case ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && parent.AsBinaryExpression().Right == value:
		return messageText(parent.AsBinaryExpression().Left, "the assignment's target"), "", storedOther
	}
	return "", "", storedNot
}
