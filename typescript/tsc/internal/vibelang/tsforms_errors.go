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
				report(node.Name(), errorClassRewrite(c, file, node), node.Name().Text(), parts.baseText)
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
		if ast.IsClassDeclaration(node) && !inHatch(node) && errorClassOf(c, file, node).base == schemaErrorBase && errorClassHead(node) && !nativeSchemaErrorClass(c, node) && !nativeErrorClass(c, file, node) {
			report(node.Name(), errorClassRewrite(c, file, node), node.Name().Text())
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// nativeSchemaErrorClass recognizes the native-only shapes excluded from
// EK4837 by the 2026-11-04 D284 ruling. Use this in both discovery and planning:
// an editor can request a repair using a diagnostic from an older source.
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

// nativeErrorClass reports whether class keeps its native Effect form, with
// neither an error-declaration warning nor a fix (proxy ruling 2026-11-04): a
// Schema.TaggedError class whose fields object spreads another object, or a
// Data.TaggedError or Schema.TaggedError class with a written static _tag.
//
//	class A extends Schema.TaggedError<A>()("A", { ...shared, id: Schema.String }) {}
//	class B extends Data.TaggedError("B")<{ id: string }> { static readonly _tag = "B" }
func nativeErrorClass(c *checker.Checker, file *ast.SourceFile, class *ast.Node) bool {
	if slices.ContainsFunc(class.Members(), func(m *ast.Node) bool {
		return ast.HasSyntacticModifier(m, ast.ModifierFlagsStatic) && errorMemberIsReservedTag(c, m)
	}) {
		return true
	}
	if errorClassOf(c, file, class).base != schemaErrorBase {
		return false
	}
	arguments := ast.GetClassExtendsHeritageElement(class).Expression().Arguments()
	return len(arguments) >= 2 && ast.IsObjectLiteralExpression(arguments[1]) &&
		slices.ContainsFunc(arguments[1].AsObjectLiteralExpression().Properties.Nodes, ast.IsSpreadAssignment)
}

// errorClassRewrite plans EK4830's fix for class.
func errorClassRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node) *formRewrite {
	if class.TypeParameters() != nil {
		return nil
	} // VIP-13: a generic class has no error-declaration equivalent.
	if nativeErrorClass(c, file, class) {
		return &formRewrite{why: "No quick fix: a class with spread fields or a static _tag keeps its native Effect form."}
	}
	parts := errorClassOf(c, file, class)
	if parts.base == schemaErrorBase {
		if !errorClassHead(class) || nativeSchemaErrorClass(c, class) {
			return nil
		}
	} else if parts.base == notErrorBase || !errorClassShape(file, class) {
		return nil
	}
	name := class.Name().Text()
	tag, literal := "", false
	if parts.tag != nil && ast.IsStringLiteralLike(parts.tag) {
		tag, literal = parts.tag.Text(), true
	}
	silence := " Keep the class if something depends on that, and silence this line with // @vibelang-diagnostics-next-line EK4830:off."
	switch {
	case parts.base == schemaErrorBase:
		return schemaErrorRewrite(c, file, class, parts.baseText, tag, literal)
	case parts.base == dataErrorBase:
		return &formRewrite{why: "No quick fix: an error declaration adds a _tag, \"" + name + "\", which Data.Error has none of." + silence}
	case !literal:
		return &formRewrite{why: "No quick fix: the tag is not a string literal, and an error declaration's tag is its name."}
	case tag != name:
		return &formRewrite{why: "No quick fix: an error declaration's tag is its name, so the tag would become \"" + name + "\" instead of \"" + tag + "\"." + silence}
	case parts.fields != nil && !ast.IsTypeLiteralNode(parts.fields):
		return &formRewrite{why: "No quick fix: the fields come from " + expressionText(file, parts.fields) + "; write them in the declaration."}
	case parts.fields != nil && len(parts.fields.Members()) == 0:
		// Detail 273: a fieldless error has no payload type argument.
		// Erasing a written <{}> would change the declaration bytes,
		// including the sidecar under noEmit (Chapter 7).
		return &formRewrite{why: "No quick fix: an error declaration drops the explicit empty payload type argument from the declaration file; keep the class to preserve its declaration output."}
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

// schemaErrorRewrite plans EK4837's fix for class, which extends base, written
// so: a schema error declaration keeps its Schema, tag and accessors (D279). In
// a project that emits declarations, the file keeps its import of Schema, which
// the declaration file prints (D501), and a base spelled another way keeps the
// class, since that file would print Schema. A field whose codec has no type
// form is named by a constant before the declaration, which a schema error's
// field may name:
//
//	class Failed extends Schema.TaggedError<Failed>()("Failed", {   const FailedCauseField = Schema.Defect()
//	  cause: Schema.Defect(),                                       schema error Failed {
//	}) {}                                                             cause: FailedCauseField
//	                                                                }
func schemaErrorRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node, base string, tag string, literal bool) *formRewrite {
	no := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why}
	}
	name := class.Name().Text()
	arguments := ast.GetClassExtendsHeritageElement(class).Expression().Arguments()
	switch {
	// The sidecar prints the base too, whatever the emit options (Chapter 7).
	case base != "Schema.TaggedError":
		return no("the declaration file would print Schema.TaggedError, not " + base + ".")
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
	var lines, constants []string
	end := nodeStart(file, object) + 1
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		// The gaps contain the fields' leading and trailing comments. Keep
		// them as separate lines so a trailing // cannot swallow a field.
		gap := text[end:nodeStart(file, property)]
		if schemaErrorUnattachedJSDoc(file, property, gap) {
			return no("a JSDoc comment would gain a new member attachment.")
		}
		lines = append(lines, rewriteComments.FindAllString(gap, -1)...)
		if hasComment(text[nodeStart(file, property):property.End()]) {
			return no("a comment inside a field would be lost.")
		}
		field, constant, why := schemaErrorField(c, file, property, name)
		if why != "" {
			return no(why)
		}
		lines = append(lines, field)
		end = property.End()
		if constant != "" {
			constants = append(constants, constant)
		}
	}
	closing := rewriteComments.FindAllString(text[end:object.End()-1], -1)
	for _, comment := range closing {
		if strings.HasPrefix(comment, "/**") && len(class.Members()) != 0 {
			return no("a trailing fields JSDoc comment would become member documentation.")
		}
	}
	lines = append(lines, closing...)
	memberEnd := class.AsClassDeclaration().Members.Pos()
	for _, member := range class.Members() {
		if key := member.Name(); key != nil && ast.IsComputedPropertyName(key) &&
			keyDomainMayBeTag(c, c.GetTypeAtLocation(key.Expression()), 0) {
			return no("a computed member key may be \"_tag\", which a schema error declaration reserves.")
		}
		if ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) || errorMemberIsReservedTag(c, member) {
			return no("the class has a static or reserved _tag member that an error declaration cannot keep.")
		}
		// An accessor runs as plain JavaScript (D282), and a written return
		// type keeps a method's form; anything else would change meaning.
		method := ast.IsMethodDeclaration(member) && member.Type() != nil
		if !ast.IsGetAccessorDeclaration(member) && !method && !ast.IsSemicolonClassElement(member) {
			return no("a schema error's body keeps accessors and annotated methods.")
		}
		// The member's full range starts after the previous member (or
		// the opening brace), retaining its leading comments and JSDoc.
		if schemaErrorUnattachedJSDoc(file, member, text[memberEnd:nodeStart(file, member)]) {
			return no("a JSDoc comment would gain a new member attachment.")
		}
		lines = append(lines, strings.TrimSpace(text[memberEnd:member.End()]))
		memberEnd = member.End()
	}
	if gap := text[memberEnd : class.End()-1]; hasComment(gap) {
		lines = append(lines, strings.TrimSpace(gap))
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
	// A private class starts exactly where its generated codec constants
	// are inserted. Apply that insertion and replacement as one edit;
	// otherwise the insertion shifts the replacement's original offsets.
	edits = joinEditsAt(edits)
	rewrite := &formRewrite{edits: edits, description: "schema error " + name + " { … }"}
	// Source unused checks take priority over declaration preservation
	// (declarationImportKeys), so noUnusedLocals removes the import now unread.
	if c.CompilerOptions().NoUnusedLocals.IsTrue() {
		return withImportRemovals(c, file, rewrite)
	}
	// Imports stay for the declaration-aware cleanup (keepDeclaredImports):
	// the sidecar may still print a name the rewrite no longer reads.
	return rewrite
}

// A moved JSDoc must document the same node. In particular a comment on
// the opening brace's line is not attached in a native class, but putting
// it on its own line before the getter would attach it in the declaration.
func schemaErrorUnattachedJSDoc(file *ast.SourceFile, node *ast.Node, gap string) bool {
	attached := map[string]int{}
	for _, doc := range node.JSDoc(file) {
		attached[strings.TrimSpace(file.Text()[doc.Pos():doc.End()])]++
	}
	for _, comment := range rewriteComments.FindAllString(gap, -1) {
		if strings.HasPrefix(comment, "/**") {
			if attached[comment] == 0 {
				return true
			}
			attached[comment]--
		}
	}
	return false
}

// schemaErrorField returns property, a field of a Schema.TaggedError's
// object, as a schema error's field, and the constant that names its codec
// when it has no type form, or why it cannot be written.
func schemaErrorField(c *checker.Checker, file *ast.SourceFile, property *ast.Node, class string) (field string, constant string, why string) {
	if ast.IsPropertyAssignment(property) {
		if known, immutable := schemaStructValueReadonly(c, property.Initializer()); known && !immutable {
			return "", "", "the field's decoded key is not known to be readonly; keep the native class."
		}
	}
	if isNativeProtoSetter(property) {
		return "", "", "the native __proto__ property sets the fields object's prototype, but a schema error field creates an own key."
	}
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
	// The inline field is contextually checked by TaggedError. Re-inference
	// at an unannotated binding can select different generic defaults.
	annotation := ""
	if c.GetContextualType(value, checker.ContextFlagsNone) != nil {
		format := checker.TypeFormatFlagsNoTruncation | checker.TypeFormatFlagsUseFullyQualifiedType | checker.TypeFormatFlagsUseSourceScope | checker.TypeFormatFlagsUseStructuralFallback
		annotation = ": " + c.TypeToStringEx(c.GetTypeAtLocation(value), value, format, nil)
	}
	constant = "const " + name + annotation + " = " + expressionText(file, value)
	if optional {
		// key?: Name | undefined maps to Schema.optional(Name) under either
		// exactOptionalPropertyTypes setting (structFieldType).
		return key + "?: " + name + " | undefined", constant, ""
	}
	return key + ": " + name, constant, ""
}
