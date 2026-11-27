package vibelangestree

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// effectType converts A!E!R, which the parser writes Effect.Effect<A, E, R>
// with a synthesized name and synthesized never or infer R slots.
func (c *converter) effectType(n *ast.Node) *obj {
	reference := n.AsTypeReferenceNode()
	name := reference.TypeName
	if name.Kind != ast.KindQualifiedName || !synthesized(name) || reference.TypeArguments == nil || len(reference.TypeArguments.Nodes) != 3 {
		return nil
	}
	slots := reference.TypeArguments.Nodes
	slot := func(t *ast.Node) any {
		if synthesized(t) {
			return nil
		}
		return c.convertChild(t, n)
	}
	r := c.rangeOf(n)
	for _, t := range slots {
		if !synthesized(t) {
			r.end = max(r.end, t.End())
		}
	}
	return c.nodeAt(r, "VibeEffectType").
		set("success", c.convertChild(slots[0], n)).
		set("failure", slot(slots[1])).
		set("requirements", slot(slots[2]))
}

func (c *converter) vibeCall(n *ast.Node) *obj {
	call := n.AsCallExpression()
	arguments := listNodes(call.Arguments)
	callee := call.Expression
	switch {
	case callee.Kind == ast.KindPropertyAccessExpression &&
		isSynthesizedIdentifier(callee.AsPropertyAccessExpression().Name(), "bind") &&
		len(arguments) == 1 && synthesized(arguments[0]):
		// Do lowering captures a method as e.m.bind(e) before its arguments
		// run. Only e.m is written: exposing the generated binding call makes
		// rules inspect its imaginary parentheses and can duplicate reports.
		// Keep the source method read, including computed keys and user bind
		// properties; a source-written .bind call never has this marker.
		return c.convertChild(callee.Expression(), n)
	case len(arguments) == 1 && c.isPatternMatcher(callee):
		// The parser captures a subject with an arrow invocation so it is
		// evaluated once. There is no written call around the pattern:
		// retain its matcher scope and subject, without exposing imaginary
		// call parentheses to source-based rules.
		res := c.convertCall(n).set("type", "VibeIsExpression")
		if fn, ok := res.get("callee").(*obj); ok {
			fixParentLocation(res, fn.rng())
		}
		if args, ok := res.get("arguments").([]any); ok {
			for _, arg := range args {
				if a, ok := arg.(*obj); ok {
					fixParentLocation(res, a.rng())
				}
			}
		}
		return res
	case isSynthesizedIdentifier(callee, "$catchExpression") && len(arguments) == 2:
		self, handler := arguments[0], arguments[1]
		result := c.node(n, "VibeCatchExpression").set("expression", c.convertChild(programBody(self), self))
		if isProgramArrow(handler) {
			result.set("handler", c.convertChild(programBody(handler), handler))
		} else {
			result.set("handler", c.convertChild(handler, n))
		}
		return result
	case callee.Kind == ast.KindPropertyAccessExpression && isSynthesizedIdentifier(callee.AsPropertyAccessExpression().Name(), "pipe") && len(arguments) == 1:
		// D272: x |> f(args)(%) parses as x.pipe(f(args)).
		stage := arguments[0]
		right := c.convertChild(stage, n)
		open, openKind := c.tokenAfter(stage.End())
		topic, topicKind := c.tokenAfter(open.end)
		closing, closeKind := c.tokenAfter(topic.end)
		if openKind == ast.KindOpenParenToken && topicKind == ast.KindPercentToken && closeKind == ast.KindCloseParenToken {
			right = c.nodeAt(span{c.start(stage), closing.end}, "CallExpression").
				set("arguments", []any{c.nodeAt(topic, "TopicReference")}).
				set("callee", right).
				set("optional", false)
		}
		return c.node(n, "VibePipeExpression").
			set("left", c.convertChild(callee.Expression(), callee)).
			set("right", right)
	}
	return nil
}

// triedTaggedTemplate converts try tag`…`, which the parser writes as the
// tagged template itself, flagged and starting at try (parser/vibelang_try.go),
// as $try(tag`…`): the call the parser writes for any operand other than a
// call. A tagged template statement reads to ESLint as an unused expression;
// a tried one runs its Effect, as a call statement does.
func (c *converter) triedTaggedTemplate(n *ast.Node) *obj {
	tagged := n.AsTaggedTemplateExpression()
	keyword, _ := c.tokenAfter(n.Pos())
	template := c.nodeAt(span{c.start(tagged.Tag), n.End()}, "TaggedTemplateExpression").
		set("quasi", c.convertChild(tagged.Template, n)).
		set("tag", c.convertChild(tagged.Tag, n))
	if typeArguments := c.convertTypeArguments(tagged.TypeArguments, n); typeArguments != nil {
		template.set("typeArguments", typeArguments)
	}
	callee := identifierShape(c.nodeAt(keyword, "Identifier"), "$try").set("synthesized", true)
	return c.node(n, "CallExpression").
		set("arguments", []any{template}).
		set("callee", callee).
		set("optional", false)
}

// isPatternMatcher recognizes only the parser's subject-capturing arrow at
// an is keyword. A written arrow, even one naming $is1, has no synthetic =>;
// other generated arrows (do, throw, catch) anchor their => at their own keywords.
func (c *converter) isPatternMatcher(callee *ast.Node) bool {
	arrow := ast.SkipParentheses(callee)
	if !isProgramArrow(arrow) {
		return false
	}
	_, kind := c.tokenAfter(arrow.AsArrowFunction().EqualsGreaterThanToken.Pos())
	return kind == ast.KindIsKeyword
}

// concurrentStatement retains the source loop instead of the parser's
// $forConcurrent invocation. The callback keeps the item's binding scope;
// only a written limit has a source node. Calls inside any of these children
// remain ordinary calls for rules to inspect.
func (c *converter) concurrentStatement(n *ast.Node) *obj {
	expression := n.Expression()
	if expression == nil || expression.Kind != ast.KindCallExpression {
		return nil
	}
	call := expression.AsCallExpression()
	args := listNodes(call.Arguments)
	if !isSynthesizedIdentifier(call.Expression, "$forConcurrent") || len(args) != 3 {
		return nil
	}
	var concurrency any
	if !synthesized(args[1]) {
		concurrency = c.convertChild(args[1], expression)
	}
	return c.node(n, "VibeForConcurrentStatement").
		set("iterable", c.convertChild(args[0], expression)).
		set("concurrency", concurrency).
		set("body", c.convertChild(args[2], expression))
}

// concurrentHead keeps the lexical cells that shadow outer names in the
// iterable, without exposing the generated jump that leaves them uninitialized.
// That jump is runtime bookkeeping, not unreachable code in the source.
func (c *converter) concurrentHead(n *ast.Node) *obj {
	labeled := n.AsLabeledStatement()
	if !synthesized(labeled.Label) || !strings.HasPrefix(labeled.Label.Text(), "$concurrentHead") || labeled.Statement.Kind != ast.KindBlock {
		return nil
	}
	var statements []*ast.Node
	for _, statement := range labeled.Statement.Statements() {
		if statement.Kind == ast.KindBreakStatement && isSynthesizedIdentifier(statement.AsBreakStatement().Label, labeled.Label.Text()) {
			continue
		}
		statements = append(statements, statement)
	}
	return c.node(n, "BlockStatement").set("body", c.convertBodyExpressions(statements, labeled.Statement, n))
}

// isProgramArrow reports whether n is an arrow function the parser wrote
// around a program: its => is synthesized.
func isProgramArrow(n *ast.Node) bool {
	if n == nil || n.Kind != ast.KindArrowFunction {
		return false
	}
	return synthesized(n.AsArrowFunction().EqualsGreaterThanToken)
}

func programBody(arrow *ast.Node) *ast.Node {
	if isProgramArrow(arrow) {
		return arrow.Body()
	}
	return arrow
}

func (c *converter) vibeBlock(n *ast.Node, parent *ast.Node) *obj {
	statements := n.Statements()
	if len(statements) == 0 {
		return nil
	}
	first := statements[0]
	switch {
	case n.Flags&ast.NodeFlagsVibeLang != 0 && first.Kind == ast.KindExpressionStatement && first.Flags&ast.NodeFlagsVibeLang != 0:
		layer := first.Expression()
		var providers []any
		if layer.Kind == ast.KindArrayLiteralExpression && !c.sourceStartsWith(layer, "[") {
			for _, element := range listNodes(layer.AsArrayLiteralExpression().Elements) {
				providers = append(providers, c.provider(element, layer))
			}
		} else {
			providers = append(providers, c.provider(layer, first))
		}
		body := c.blockAfter(layer.End(), n.End(), statements[1:], n, parent)
		return c.node(n, "VibeProvideStatement").set("providers", providers).set("body", body)
	case first.Kind == ast.KindExpressionStatement && synthesized(first) && first.Expression().Kind == ast.KindCallExpression:
		marker := first.Expression().Expression()
		if marker.Kind != ast.KindIdentifier || !synthesized(marker) {
			return nil
		}
		kind, ok := map[string]string{
			"$uninterruptibleBlock": "uninterruptible",
			"$restoreBlock":         "restore",
			"$interruptibleBlock":   "interruptible",
		}[marker.Text()]
		if !ok {
			return nil
		}
		body := c.blockAfter(first.End(), n.End(), statements[1:], n, parent)
		return c.node(n, "VibeMaskStatement").set("kind", kind).set("body", body)
	}
	return nil
}

// provider converts one provider of a provide statement.
func (c *converter) provider(n *ast.Node, parent *ast.Node) *obj {
	if n.Kind == ast.KindCallExpression && isSynthesizedIdentifier(n.Expression(), "$provideService") && len(n.Arguments()) == 3 {
		arguments := n.Arguments()
		return c.node(n, "VibeServiceProvider").
			set("key", c.convertChild(arguments[0], n)).
			set("value", c.convertChild(arguments[2], n))
	}
	return c.convertChild(n, parent)
}

// blockAfter converts statements as the block that opens at the first { at
// or after pos and closes at end.
func (c *converter) blockAfter(pos int, end int, statements []*ast.Node, container *ast.Node, containerParent *ast.Node) *obj {
	open := pos
	for {
		r, kind := c.tokenAfter(open)
		if kind == ast.KindEndOfFile || r.start >= end {
			open = end
			break
		}
		if kind == ast.KindOpenBraceToken {
			open = r.start
			break
		}
		open = r.end
	}
	return c.nodeAt(span{open, end}, "BlockStatement").set("body", c.convertBodyExpressions(statements, container, containerParent))
}

func (c *converter) sourceStartsWith(n *ast.Node, prefix string) bool {
	return strings.HasPrefix(c.text[c.start(n):], prefix)
}

// schemaDeclaration converts `schema S { fields }`, which the parser writes
// as const S = Schema.Struct({ ... }) beside a synthesized interface, to
// const S: { fields }, so the fields' types are read as the author wrote them.
func (c *converter) schemaDeclaration(n *ast.Node) *obj {
	list := n.AsVariableStatement().DeclarationList
	declarations := listNodes(list.AsVariableDeclarationList().Declarations)
	if len(declarations) != 1 {
		return nil
	}
	declaration := declarations[0].AsVariableDeclaration()
	fields := declaration.Initializer
	if fields == nil || fields.Kind != ast.KindCallExpression || fields.Flags&ast.NodeFlagsVibeLang == 0 {
		return nil
	}
	after := n.Pos()
	if mods := n.ModifierNodes(); len(mods) != 0 {
		after = mods[len(mods)-1].End()
	}
	keyword, _ := c.tokenAfter(after)
	if c.text[keyword.start:keyword.end] != "schema" {
		return nil
	}
	name := declarations[0].Name()
	id := c.convertChild(name, declarations[0])
	if parser.IsSchemaTaggedUnion(fields) {
		c.attachSchemaDataAnnotation(id, fields)
	} else if literal := c.schemaBody(fields); literal != nil {
		c.attachSchemaAnnotation(id, literal)
	}
	declarator := c.nodeAt(span{c.start(name), n.End()}, "VariableDeclarator").
		set("definite", false).
		set("id", id).
		set("init", nil)
	result := c.node(n, "VariableDeclaration").
		set("declarations", []any{declarator}).
		set("declare", hasModifier(ast.KindDeclareKeyword, n)).
		set("kind", "const")
	return c.fixExports(n, result)
}

// attachSchemaDataAnnotation attaches a TSTypeLiteral annotation for a
// `schema data` declaration's variants and parsed field types.
func (c *converter) attachSchemaDataAnnotation(id *obj, call *ast.Node) {
	args := call.Arguments()
	if len(args) == 0 || args[0].Kind != ast.KindObjectLiteralExpression {
		return
	}
	variantsObj := args[0]
	members := []any{}
	for _, prop := range variantsObj.AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(prop) {
			continue
		}
		vName := prop.Name()
		member := c.nodeAt(c.rangeOf(vName), "TSPropertySignature").
			set("computed", isComputed(vName)).
			set("key", c.convertChild(vName, prop)).
			set("optional", false).
			set("readonly", false)
		if init := prop.Initializer(); init != nil && !synthesized(init) {
			if literal := c.schemaBody(init); literal != nil {
				body := c.convertChild(literal, literal.Parent)
				schemaValues(body)
				member.set("typeAnnotation", c.nodeAt(c.rangeOf(init), "TSTypeAnnotation").set("typeAnnotation", body))
				member.setRange(span{c.start(vName), init.End()})
			}
		}
		members = append(members, member)
	}
	body := c.node(variantsObj, "TSTypeLiteral").set("members", members)
	annotation := c.nodeAt(span{id.rng().end, variantsObj.End()}, "TSTypeAnnotation").set("typeAnnotation", body)
	id.set("typeAnnotation", annotation)
	fixParentLocation(id, annotation.rng())
}

// A schema reads as a typed const binding. As for a written annotation,
// the identifier's range includes its type, while its name token stays narrow.
func (c *converter) attachSchemaAnnotation(id *obj, typ *ast.Node) {
	body := c.convertChild(typ, typ.Parent)
	schemaValues(body)
	// There is no written colon. A rename rule can replace everything before
	// this annotation, so its range must include the intervening trivia and
	// the equals sign of an alias. The child type keeps its own token range.
	annotation := c.nodeAt(span{id.rng().end, typ.End()}, "TSTypeAnnotation").set("typeAnnotation", body)
	id.set("typeAnnotation", annotation)
	fixParentLocation(id, annotation.rng())
}

// schemaValues rewrites each type reference without type arguments in value,
// the projection of a schema's field types, as a type query of the same name.
// The parser maps such a reference to a read of the value it names
// (vibelangSchemaOf), so for scope analysis it is a value reference, as
// typeof Name is; without it no-unused-vars reports the codec a field names:
//
//	const Names = Schema.Tuple([Schema.String, Schema.String])
//	schema Locale { names: Names }   // const Locale: { names: typeof Names }
//
// A reference with type arguments, Array<T> or Record<K, V>, stays a type
// reference, and its arguments are mapped in turn. The query's first name
// carries schemaValue, so eslint.mjs gives what it resolves to a value read
// outside the type: typescript-eslint counts typeof in a type as a type use.
func schemaValues(value any) {
	switch v := value.(type) {
	case *obj:
		if v.typ() == "TSTypeReference" && v.get("typeArguments") == nil {
			v.set("type", "TSTypeQuery")
			for i, key := range v.keys {
				if key == "typeName" {
					v.keys[i] = "exprName"
				}
			}
			name, _ := v.get("exprName").(*obj)
			for name != nil && name.typ() == "TSQualifiedName" {
				name, _ = name.get("left").(*obj)
			}
			if name != nil && name.typ() == "Identifier" {
				name.set("schemaValue", true)
			}
			return
		}
		for _, child := range v.vals {
			schemaValues(child)
		}
	case []any:
		for _, child := range v {
			schemaValues(child)
		}
	}
}

// schemaBody parses the braces of a schema declaration again as an object
// type, at the same offsets, since the parser keeps only the schemas it
// wrote for the fields.
func (c *converter) schemaBody(fields *ast.Node) *ast.Node {
	start := c.start(fields)
	end := fields.End()
	if start >= end || c.text[start] != '{' || c.text[end-1] != '}' || start < 7 {
		return nil
	}
	var b strings.Builder
	b.Grow(len(c.text))
	b.WriteString(blank(c.text[:start-7]))
	b.WriteString("type _=")
	b.WriteString(c.text[start:end])
	b.WriteString(blank(c.text[end:]))
	text := b.String()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema.vibe", PathKey: "/schema.vibe"}, text, core.ScriptKindTS)
	statements := listNodes(file.Statements)
	if len(file.Diagnostics()) != 0 || len(statements) != 1 || statements[0].Kind != ast.KindTypeAliasDeclaration {
		return nil
	}
	literal := statements[0].Type()
	if literal.Kind != ast.KindTypeLiteral {
		return nil
	}
	return literal
}

// blank returns text with every byte but a line break replaced by a space.
func blank(text string) string {
	b := []byte(text)
	for i, ch := range b {
		if ch != '\n' && ch != '\r' {
			b[i] = ' '
		}
	}
	return string(b)
}

// errorFields returns the field list of an error declaration, whose base the
// parser writes TaggedError("X")<{ fields }>.
func (c *converter) errorFields(extendsType *ast.Node) (*ast.Node, bool) {
	if !c.vibe || extendsType == nil || extendsType.Kind != ast.KindExpressionWithTypeArguments {
		return nil, false
	}
	call := extendsType.Expression()
	if call.Kind != ast.KindCallExpression || !isSynthesizedIdentifier(call.Expression(), "TaggedError") {
		return nil, false
	}
	arguments := extendsType.AsExpressionWithTypeArguments().TypeArguments
	if arguments == nil || len(arguments.Nodes) != 1 {
		return nil, false
	}
	return arguments.Nodes[0], true
}

// errorBody converts an error's fields as the class's properties, which is
// what they are on an instance.
func (c *converter) errorBody(n *ast.Node, fields *ast.Node) *obj {
	if synthesized(fields) || fields.Kind != ast.KindTypeLiteral {
		return c.nodeAt(span{n.End(), n.End()}, "ClassBody").set("body", []any{})
	}
	properties := []any{}
	for _, member := range fields.Members() {
		if member.Kind != ast.KindPropertySignature {
			properties = append(properties, c.convertChild(member, fields))
			continue
		}
		signature := member.AsPropertySignatureDeclaration()
		property := c.node(member, "PropertyDefinition")
		setAccessibility(property, member)
		property.set("computed", isComputed(member.Name())).
			set("declare", false).
			set("decorators", []any{}).
			set("definite", false).
			set("key", c.convertChild(member.Name(), member)).
			set("optional", member.QuestionToken() != nil).
			set("override", false).
			set("readonly", hasModifier(ast.KindReadonlyKeyword, member)).
			set("static", false)
		if signature.Type != nil {
			property.set("typeAnnotation", c.convertTypeAnnotation(signature.Type, member))
		}
		property.set("value", nil)
		properties = append(properties, property)
	}
	// Class-source reparsing can reject a payload named constructor as a
	// TypeScript constructor declaration. Its written methods still belong
	// to this error, alongside the fields retained in the TaggedError type.
	for _, member := range listNodes(n.ClassLikeData().Members) {
		if !synthesized(member) && member.Kind != ast.KindSemicolonClassElement {
			properties = append(properties, c.convertChild(member, n))
		}
	}
	open, kind := c.tokenAfter(n.Name().End())
	if kind == ast.KindOpenBraceToken {
		return c.nodeAt(span{open.start, n.End()}, "ClassBody").set("body", properties)
	}
	return c.node(fields, "ClassBody").set("body", properties)
}
