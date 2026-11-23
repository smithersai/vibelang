package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4830 (D284): an error class written the way Effect's TypeScript writes
// one, where an error declaration (D126) says the same:
//
//	class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
//	error NotFound { id: string }
//
// The fix applies when the class extends Data.TaggedError, or the prelude's
// TaggedError, with a string literal tag equal to its name, its fields are an
// object type written in place, and its body is empty. Otherwise a class that
// an error declaration could still replace, one with an empty body, draws the
// warning without a fix, and its note says what a declaration would change:
// a tag other than the name, or the _tag that Data.Error lacks. A
// Schema.TaggedError class draws EK4837 instead, whose fix writes D279's
// schema error, which keeps its Schema (schemaErrorRewrite). Any other class
// with members, a constructor, decorators, or another base draws nothing until
// the parser accepts D278's error declarations with class members.

func init() {
	tsFormRules[EK4830.Code] = &tsFormRule{
		message: EK4830,
		find:    findErrorClasses,
	}
	tsFormRules[EK4837.Code] = &tsFormRule{
		message: EK4837,
		find:    findSchemaErrorClasses,
	}
}

// errorBase is what an error class extends.
type errorBase uint8

const (
	notErrorBase    errorBase = iota
	taggedErrorBase           // Data.TaggedError("tag") or TaggedError("tag")
	dataErrorBase             // Data.Error
	schemaErrorBase           // Schema.TaggedError<Self>()("tag", { … })
)

// errorClass is an error class's parts.
type errorClass struct {
	base     errorBase
	baseText string // the base as written, for the message
}

// errorClassOf returns the parts of class when it extends an Effect error
// base, or base notErrorBase.
func errorClassOf(c *checker.Checker, file *ast.SourceFile, class *ast.Node) errorClass {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil {
		return errorClass{}
	}
	expression := extends.Expression()
	result := errorClass{}
	switch {
	case ast.IsCallExpression(expression):
		callee := expression.Expression()
		if callee.Flags&ast.NodeFlagsReparsed != 0 {
			return errorClass{} // an error declaration (D126)
		}
		arguments := expression.Arguments()
		switch {
		case isEffectFunction(c, callee, "Data", "TaggedError") || isRuntimeExport(c, callee, "TaggedError"):
			if len(arguments) != 1 {
				return errorClass{}
			}
			result = errorClass{base: taggedErrorBase}
			if len(extends.TypeArguments()) > 1 {
				return errorClass{}
			}
		case ast.IsCallExpression(callee) && isEffectFunction(c, callee.Expression(), "Schema", "TaggedError"):
			if len(arguments) < 1 {
				return errorClass{}
			}
			result = errorClass{base: schemaErrorBase}
		default:
			return errorClass{}
		}
		result.baseText = expressionText(file, callee)
		if result.base == schemaErrorBase {
			result.baseText = expressionText(file, callee.Expression())
		}
	case isEffectFunction(c, expression, "Data", "Error"):
		result = errorClass{base: dataErrorBase, baseText: expressionText(file, expression)}
		if len(extends.TypeArguments()) > 1 {
			return errorClass{}
		}
	default:
		return errorClass{}
	}
	return result
}

// errorClassShape reports whether class could be an error declaration apart
// from its base: a named class declaration, exported or not, with no other
// modifiers, no implements clause, and an empty body.
func errorClassShape(file *ast.SourceFile, class *ast.Node) bool {
	if !errorClassHead(class) || class.TypeParameters() != nil {
		return false
	}
	if slices.ContainsFunc(class.Members(), func(m *ast.Node) bool { return !ast.IsSemicolonClassElement(m) }) {
		return false
	}
	extends := ast.GetClassExtendsHeritageElement(class)
	return strings.TrimSpace(strings.Trim(strings.TrimSpace(file.Text()[extends.End():class.End()]), "{}")) == ""
}

// errorClassHead reports whether class's head could be an error declaration's:
// a named class declaration, exported or not, with no other modifiers and no
// implements clause.
func errorClassHead(class *ast.Node) bool {
	if class.Name() == nil || class.Flags&ast.NodeFlagsAmbient != 0 || len(ast.GetImplementsHeritageClauseElements(class)) != 0 {
		return false
	}
	return !slices.ContainsFunc(class.ModifierNodes(), func(modifier *ast.Node) bool { return modifier.Kind != ast.KindExportKeyword })
}

// findErrorClasses reports EK4830 at each error class of file that an error
// declaration could replace.
func findErrorClasses(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && !inHatch(node) {
			parts := errorClassOf(c, file, node)
			if parts.base != notErrorBase && parts.base != schemaErrorBase && errorClassShape(file, node) {
				report(node.Name(), nil, node.Name().Text(), parts.baseText)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// findSchemaErrorClasses reports EK4837 at each Schema.TaggedError class of
// file. Its body may hold what a schema error's does, but native spread
// fields and a written static _tag have no declaration equivalent (D284).
func findSchemaErrorClasses(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && !inHatch(node) && errorClassOf(c, file, node).base == schemaErrorBase && errorClassHead(node) && !nativeSchemaErrorClass(c, node) {
			report(node.Name(), nil, node.Name().Text())
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// nativeSchemaErrorClass recognizes the native-only shapes excluded from
// the schema error diagnostic.
func nativeSchemaErrorClass(c *checker.Checker, class *ast.Node) bool {
	for _, member := range class.Members() {
		if ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) && errorMemberIsReservedTag(c, member) {
			return true
		}
	}
	arguments := ast.GetClassExtendsHeritageElement(class).Expression().Arguments()
	if len(arguments) >= 2 && ast.IsObjectLiteralExpression(arguments[1]) {
		return slices.ContainsFunc(arguments[1].AsObjectLiteralExpression().Properties.Nodes, ast.IsSpreadAssignment)
	}
	return false
}
