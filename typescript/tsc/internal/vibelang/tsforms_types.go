package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4833 (D287, D308, D309): an Effect type written through the Effect
// module, which the ! form (D127) writes in fewer tokens:
//
//	Effect.Effect<User, NotFound, Db>   User!NotFound!Db
//	Effect.Effect<User>                 User!!
//
// An omitted slot is never everywhere (VIP-3). Explicit infer types have
// no shorthand rewrite: the ! form is exactly an alias of Effect<A, E, R>.

func init() {
	tsFormRules[EK4833.Code] = &tsFormRule{
		message:   EK4833,
		find:      findEffectTypes,
		plan:      effectTypeRewrite,
		diagnosed: ast.IsTypeReferenceNode,
	}
}

// isEffectTypeName reports whether reference, a type reference, names
// effect's Effect interface, as Effect.Effect or as the prelude's Effect type,
// in source the user wrote.
func isEffectTypeName(c *checker.Checker, reference *ast.Node) bool {
	name := reference.AsTypeReferenceNode().TypeName
	if name.Flags&ast.NodeFlagsReparsed != 0 || reference.Flags&ast.NodeFlagsJSDoc != 0 {
		return false // an A!E!R the parser expanded
	}
	if rightmostName(name).Text() != "Effect" {
		return false
	}
	// Resolved Effect identity alone is insufficient: a custom alias named
	// Effect may reorder or wrap its arguments, default E to something other
	// than never, add requirements, or denote a union. The rewrite below uses
	// the written arguments, so prove they are the instantiated Effect slots
	// before offering either the warning or its editor/CLI repair (VIP-3,
	// Chapter 7's type/declaration preservation rule).
	t := c.GetTypeFromTypeNode(reference)
	if t == nil || t.Flags()&checker.TypeFlagsObject == 0 ||
		t.ObjectFlags()&checker.ObjectFlagsReference == 0 {
		return false
	}
	// A lookalike interface may declare its own Effect marker. Only the
	// interface exported by effect/Effect has the shorthand's contract.
	if own := analyzerFor(c).programEffectInterface(); own == nil || t.Symbol() != own.Symbol() {
		return false
	}
	slots, arguments := c.GetTypeArguments(t), reference.TypeArguments()
	if len(slots) != 3 || len(arguments) == 0 || len(arguments) > len(slots) {
		return false
	}
	for i, slot := range slots {
		if i < len(arguments) {
			if slot != c.GetTypeFromTypeNode(arguments[i]) {
				return false
			}
		} else if slot.Flags()&checker.TypeFlagsNever == 0 {
			return false
		}
	}
	return true
}

// findEffectTypes reports EK4833 at each Effect type of file written through
// the Effect module, Effect.Effect<...>, that the ! form can write.
func findEffectTypes(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsTypeReferenceNode(node) && ast.IsQualifiedName(node.AsTypeReferenceNode().TypeName) && isEffectTypeName(c, node) {
			if rewrite := effectTypeRewrite(c, file, node); rewrite != nil {
				report(node, rewrite, messageText(node, "This Effect type"), rewrite.description)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isBodyReturnAnnotation reports whether node is the return annotation of a
// function with a body.
func isBodyReturnAnnotation(node *ast.Node) bool {
	fn := node.Parent
	return fn != nil && ast.IsFunctionLike(fn) && fn.Type() == node && fn.Body() != nil
}

// effectTypeRewrite plans EK4833's fix for reference.
func effectTypeRewrite(c *checker.Checker, file *ast.SourceFile, reference *ast.Node) *formRewrite {
	if !isEffectTypeName(c, reference) {
		return nil
	}
	if reference.Parent != nil && ast.IsHeritageClause(reference.Parent) {
		return nil // extends Effect.Effect<…> names an interface to extend, which A!E!R is not
	}
	arguments := reference.TypeArguments()
	if len(arguments) == 0 || len(arguments) > 3 {
		return nil
	}
	for _, argument := range arguments {
		if ast.NodeIsMissing(argument) {
			return nil // a type argument left out, as in Effect.Effect<A, , R>: a syntax error the parser reported
		}
		if ast.IsInferTypeNode(argument) {
			return nil
		}
	}
	keepNever := c.CompilerOptions().GetEmitDeclarations() && isExportedStatementPart(reference)
	slot := func(i int) string {
		if i >= len(arguments) || arguments[i].Kind == ast.KindNeverKeyword && !keepNever {
			return ""
		}
		return bangSlot(expressionText(file, arguments[i]), i > 0)
	}
	success, errors, dependencies := slot(0), slot(1), slot(2)
	if success == "" {
		success = "never"
	}
	var text string
	switch {
	case dependencies != "":
		text = success + "!" + errors + "!" + dependencies
	default:
		text = success + "!" + errors
		if errors == "" {
			text = success + "!!"
		}
	}
	if needsBangParentheses(reference) {
		text = "(" + text + ")"
	}
	// Chapter 7's advisory still teaches the equivalent, grouped spelling
	// when the edit is unsafe. Details260/277 apply through the full --fix
	// fixed point: a later style pass must not undo migration qualification.
	if !effectShorthandKeepsGrouping(file, reference) {
		return &formRewrite{
			description: text,
			why:         "No quick fix: keep the qualified Effect type here to preserve grouping and declaration output.",
		}
	}
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, reference), reference.End(), text}}, description: text}
}

// isExportedStatementPart reports whether node stands in a top-level
// statement that exports what it declares, whose declaration file prints it.
func isExportedStatementPart(node *ast.Node) bool {
	for ; node != nil; node = node.Parent {
		if node.Parent != nil && ast.IsSourceFile(node.Parent) {
			return ast.HasSyntacticModifier(node, ast.ModifierFlagsExport)
		}
	}
	return false
}

// needsBangParentheses reports whether an Effect type in the ! form needs
// parentheses where reference stands: as a member of a union or an
// intersection, which would join its first slot; before [] or an index; as
// the operand of keyof or readonly; in a conditional type; or in a slot of
// another ! form.
func needsBangParentheses(reference *ast.Node) bool {
	parent := reference.Parent
	if parent == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindUnionType, ast.KindIntersectionType, ast.KindArrayType, ast.KindIndexedAccessType, ast.KindTypeOperator,
		ast.KindConditionalType, ast.KindOptionalType, ast.KindRestType:
		return true
	case ast.KindTypeReference:
		return parent.AsTypeReferenceNode().TypeName.Flags&ast.NodeFlagsReparsed != 0
	}
	return false
}

// Detail260's deterministic trigger does not add grouping to migrate a legacy
// alias. Existing source parentheses remain available; an enclosing position
// or channel that needs new parentheses instead retains the qualified type.
func effectShorthandKeepsGrouping(file *ast.SourceFile, node *ast.Node) bool {
	if needsBangParentheses(node) || node.Parent != nil &&
		(ast.IsHeritageClause(node.Parent) || ast.IsParenthesizedTypeNode(node.Parent)) {
		return false
	}
	for i, argument := range node.TypeArguments() {
		// emptySlots deliberately removes bang grouping from declarations.
		// Qualification retains the source's existing parentheses and exact
		// declaration bytes, as the migration contract requires (detail277).
		if ast.IsParenthesizedTypeNode(argument) {
			return false
		}
		text := expressionText(file, argument)
		if hasTopLevel(text, "|") || hasTopLevel(text, "&") || bangSlot(text, i > 0) != text {
			return false
		}
	}
	return true
}
