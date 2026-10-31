package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
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
		plan: func(c *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
			return errorClassRewrite(c, file, at.Parent)
		},
		diagnosed: isClassName,
	}
	tsFormRules[EK4837.Code] = &tsFormRule{
		message: EK4837,
		find:    findSchemaErrorClasses,
		plan: func(c *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
			return errorClassRewrite(c, file, at.Parent)
		},
		diagnosed: isClassName,
	}
}

// isClassName reports whether node is the name of a class declaration.
func isClassName(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Parent != nil && ast.IsClassDeclaration(node.Parent) && node.Parent.Name() == node
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
	baseText string    // the base as written, for the message
	tag      *ast.Node // the tag argument, or nil
	fields   *ast.Node // the fields' type argument, or nil
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
			result = errorClass{base: taggedErrorBase, tag: arguments[0]}
			if arguments := extends.TypeArguments(); len(arguments) == 1 {
				result.fields = arguments[0]
			} else if len(arguments) > 1 {
				return errorClass{}
			}
		case ast.IsCallExpression(callee) && isEffectFunction(c, callee.Expression(), "Schema", "TaggedError"):
			if len(arguments) < 1 {
				return errorClass{}
			}
			result = errorClass{base: schemaErrorBase, tag: arguments[0]}
		default:
			return errorClass{}
		}
		result.baseText = expressionText(file, callee)
		if result.base == schemaErrorBase {
			result.baseText = expressionText(file, callee.Expression())
		}
	case isEffectFunction(c, expression, "Data", "Error"):
		result = errorClass{base: dataErrorBase, baseText: expressionText(file, expression)}
		if arguments := extends.TypeArguments(); len(arguments) == 1 {
			result.fields = arguments[0]
		} else if len(arguments) > 1 {
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
	if !errorClassHead(class) {
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
	if class.Name() == nil || len(ast.GetImplementsHeritageClauseElements(class)) != 0 {
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
				report(node.Name(), errorClassRewrite(c, file, node), node.Name().Text(), parts.baseText)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// findSchemaErrorClasses reports EK4837 at each Schema.TaggedError class of
// file. Its body may hold what a schema error's does, so only its head counts.
func findSchemaErrorClasses(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && !inHatch(node) && errorClassOf(c, file, node).base == schemaErrorBase && errorClassHead(node) {
			report(node.Name(), errorClassRewrite(c, file, node), node.Name().Text())
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// errorClassRewrite plans EK4830's fix for class.
func errorClassRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node) *formRewrite {
	parts := errorClassOf(c, file, class)
	name := class.Name().Text()
	tag, literal := "", false
	if parts.tag != nil && ast.IsStringLiteralLike(parts.tag) {
		tag, literal = parts.tag.Text(), true
	}
	silence := " Keep the class if something depends on that, and silence this line with // @vibelang-diagnostics-next-line EK4830:off."
	switch {
	case parts.base == schemaErrorBase:
		return schemaErrorRewrite(c, file, class, tag, literal)
	case parts.base == dataErrorBase:
		return &formRewrite{why: "No quick fix: an error declaration adds a _tag, \"" + name + "\", which Data.Error has none of." + silence}
	case !literal:
		return &formRewrite{why: "No quick fix: the tag is not a string literal, and an error declaration's tag is its name."}
	case tag != name:
		return &formRewrite{why: "No quick fix: an error declaration's tag is its name, so the tag would become \"" + name + "\" instead of \"" + tag + "\"." + silence}
	case parts.fields != nil && !ast.IsTypeLiteralNode(parts.fields):
		return &formRewrite{why: "No quick fix: the fields come from " + expressionText(file, parts.fields) + "; write them in the declaration."}
	}
	text := file.Text()
	start := nodeStart(file, class)
	if modifiers := class.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		start = scanner.SkipTrivia(text, modifiers.End())
	}
	if !strings.HasPrefix(text[start:], "class") {
		return nil
	}
	declaration := "error " + name
	if class.TypeParameters() != nil {
		// The parsed heritage clause starts after the entire type-parameter
		// list. A constraint or comment may itself contain "extends".
		heritage := ast.GetHeritageClause(class, ast.KindExtendsKeyword)
		if heritage == nil {
			return nil
		}
		declaration += strings.TrimSpace(text[class.Name().End():heritage.Pos()])
	}
	if parts.fields != nil {
		if fields := errorFieldsText(file, parts.fields); strings.Trim(fields, "{} \t\r\n") != "" {
			declaration += " " + fields
		}
	}
	return withImportRemovals(c, file, &formRewrite{
		edits:       []sourceEdit{{start, class.End(), declaration}},
		description: shortText(declaration, "error "+name+" { … }"),
	})
}

// errorFieldsText returns literal, an object type, as an error declaration's
// fields: its text without the readonly modifiers, since every field of an
// error is readonly (D134).
func errorFieldsText(file *ast.SourceFile, literal *ast.Node) string {
	text := file.Text()
	start := nodeStart(file, literal)
	var removals []sourceEdit
	for _, member := range literal.AsTypeLiteralNode().Members.Nodes {
		for _, modifier := range member.ModifierNodes() {
			if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
				from := nodeStart(file, modifier)
				removals = append(removals, sourceEdit{from, scanner.SkipTriviaEx(text, modifier.End(), &scanner.SkipTriviaOptions{StopAtComments: true}), ""})
			}
		}
	}
	out := text[start:literal.End()]
	for i := len(removals) - 1; i >= 0; i-- {
		r := removals[i]
		out = out[:r.start-start] + out[r.end-start:]
	}
	return out
}

// schemaErrorRewrite plans EK4837's fix for class, which extends
// Schema.TaggedError: a schema error declaration keeps its Schema, tag and
// accessors (D279). A field whose codec has no type form is named by a
// constant before the declaration, which a schema error's field may name:
//
//	class Failed extends Schema.TaggedError<Failed>()("Failed", {   const FailedCauseField = Schema.Defect()
//	  cause: Schema.Defect(),                                       schema error Failed {
//	}) {}                                                             cause: FailedCauseField
//	                                                                }
func schemaErrorRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node, tag string, literal bool) *formRewrite {
	no := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why}
	}
	name := class.Name().Text()
	arguments := ast.GetClassExtendsHeritageElement(class).Expression().Arguments()
	switch {
	case class.TypeParameters() != nil:
		return no("a schema error has no type parameters.")
	case !literal || tag != name:
		return no("a schema error's tag is its name.")
	case len(arguments) != 2:
		return no("a schema error has no annotations argument.")
	case !ast.IsObjectLiteralExpression(arguments[1]):
		return no("the fields come from " + expressionText(file, arguments[1]) + "; write them in the declaration.")
	}
	text := file.Text()
	object := arguments[1]
	if body := text[nodeStart(file, object):object.End()]; strings.Contains(body, "//") || strings.Contains(body, "/*") {
		return no("a comment among the fields would be lost.")
	}
	var lines, constants []string
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		field, constant, why := schemaErrorField(c, file, property, name)
		if why != "" {
			return no(why)
		}
		lines = append(lines, field)
		if constant != "" {
			constants = append(constants, constant)
		}
	}
	for _, member := range class.Members() {
		// An accessor runs as plain JavaScript (D282), and a written return
		// type keeps a method's form; anything else would change meaning.
		method := ast.IsMethodDeclaration(member) && member.Type() != nil
		if !ast.IsGetAccessorDeclaration(member) && !method && !ast.IsSemicolonClassElement(member) {
			return no("a schema error's body keeps accessors and annotated methods.")
		}
		if !ast.IsSemicolonClassElement(member) {
			lines = append(lines, text[nodeStart(file, member):member.End()])
		}
	}
	start := nodeStart(file, class)
	if modifiers := class.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		start = scanner.SkipTrivia(text, modifiers.End())
	}
	declaration := "schema error " + name + " {\n  " + strings.Join(lines, "\n  ") + "\n}"
	if len(lines) == 0 {
		declaration = "schema error " + name + " {}"
	}
	edits := []sourceEdit{{start, class.End(), declaration}}
	if len(constants) != 0 {
		before := class.Pos()
		for before < len(text) && strings.ContainsRune(" \t\r\n", rune(text[before])) {
			before++
		}
		edits = append([]sourceEdit{{before, before, strings.Join(constants, "\n") + "\n"}}, edits...)
	}
	return withImportRemovals(c, file, &formRewrite{edits: edits, description: "schema error " + name + " { … }"})
}

// schemaErrorField returns property, a field of a Schema.TaggedError's
// object, as a schema error's field, and the constant that names its codec
// when it has no type form, or why it cannot be written.
func schemaErrorField(c *checker.Checker, file *ast.SourceFile, property *ast.Node, class string) (field string, constant string, why string) {
	if field, ok := structFieldType(c, file, property, "  "); ok {
		return field, "", ""
	}
	if !ast.IsPropertyAssignment(property) || !ast.IsIdentifier(property.Name()) {
		return "", "", "the field " + expressionText(file, property) + " has no schema error form."
	}
	key, value := property.Name().Text(), property.Initializer()
	optional := isSchemaCall(c, value, "optional", 1)
	if optional {
		value = value.Arguments()[0]
	}
	if known, required := schemaStructValueRequired(c, value); !optional && known && !required {
		return "", "", "the field " + key + " is an optional key, which a schema error's ? does not write."
	}
	name := class + strings.ToUpper(key[:1]) + key[1:] + "Field"
	if strings.Contains(file.Text(), name) {
		return "", "", "the name " + name + " is taken."
	}
	if optional {
		return key + "?: " + name, "const " + name + " = " + expressionText(file, value), ""
	}
	return key + ": " + name, "const " + name + " = " + expressionText(file, value), ""
}
