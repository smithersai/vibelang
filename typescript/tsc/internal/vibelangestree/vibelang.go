package vibelangestree

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The parser writes each VibeLang form as the TypeScript it abbreviates
// (internal/parser/vibelang*.go), and most of that TypeScript is also the
// right thing for a rule to read: a block param is an arrow function that
// starts its own code path, a do expression returns its completion value,
// an error is a class. The forms below would mislead a rule as TypeScript,
// so they convert to node types of their own, each with visitor keys
// (packages/compiler/eslint.mjs) so rules and scope analysis still reach
// every source node inside them:
//
//	A!E!R                  VibeEffectType { success, failure, requirements }
//	A!infer E              VibeInferType { name }, outside a conditional type
//	x |> f(%)              VibePipeExpression { left, right }, TopicReference
//	x catch (e) => y       VibeCatchExpression { expression, handler }
//	provide L, K = v { }   VibeProvideStatement { providers, body },
//	                       VibeServiceProvider { key, value }
//	uninterruptible { }    VibeMaskStatement { kind, body }
//	schema S { fields }    const S: { fields }, the fields as written, except
//	                       that a type reference without type arguments is
//	                       typeof Name, the value the schema reads
//	error E { fields }     class E { fields }
//	module text { body }   VibeModuleDeclaration { id, body: TSModuleBlock }
//	from text              Identifier { name, value }
//
// A module declaration's body (D283) is TypeScript in a source file of its
// own, at the .vibe file's offsets, so it converts as a .ts file's statements
// do; its block is a TSModuleBlock, where rules expect imports and exports
// outside a Program. An identifier module specifier, which the parser writes
// as a string literal naming that file, is the identifier written (TC39's
// ModuleSpecifier : Identifier), with the name as its value for rules that
// read a specifier's source.value.
//
// A pipe is not a BinaryExpression, as Babel has it, so a pipe statement,
// which runs its body, is not an unused expression; its topic is Babel's
// TopicReference. A handle statement's clauses are the blocks of its catch
// clause, without the parser's if chain. Names the parser synthesizes for the
// checker are marked synthesized, which eslint.mjs keeps out of scope
// analysis; a catch clause's $caught or $performed, a match statement's
// label, and the interface a schema declares are left out.

func synthesized(n *ast.Node) bool {
	return n != nil && n.Flags&ast.NodeFlagsReparsed != 0
}

func (c *converter) synthesized(n *ast.Node) bool {
	return c.vibe && synthesized(n)
}

func isSynthesizedIdentifier(n *ast.Node, name string) bool {
	return n != nil && n.Kind == ast.KindIdentifier && synthesized(n) && n.Text() == name
}

// typeArgumentNodes leaves out type arguments the parser synthesized, such as
// the empty field list of `error Timeout`.
func (c *converter) typeArgumentNodes(list *ast.NodeList) []*ast.Node {
	if !c.vibe {
		return list.Nodes
	}
	var out []*ast.Node
	for _, n := range list.Nodes {
		if !synthesized(n) {
			out = append(out, n)
		}
	}
	return out
}

// skipStatement reports whether statement is one the parser wrote with no
// source of its own: the interface a schema declaration declares.
func (c *converter) skipStatement(statement *ast.Node) bool {
	// A schema declaration's interface, a schema alias's type (D280), and a
	// generic data declaration's interface; a data declaration's constant (D307).
	return c.vibe && ((statement.Kind == ast.KindInterfaceDeclaration || statement.Kind == ast.KindTypeAliasDeclaration) && synthesized(statement) || parser.IsDataConstructors(statement))
}

func (c *converter) convertVibeLang(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if !c.vibe {
		return nil, false
	}
	switch n.Kind {
	case ast.KindIdentifier:
		if n.Flags&ast.NodeFlagsVibeLang != 0 && n.Text() == "%" {
			return c.node(n, "TopicReference"), true
		}
	case ast.KindTypeReference:
		if effect := c.effectType(n); effect != nil {
			return effect, true
		}
	case ast.KindBinaryExpression:
		binary := n.AsBinaryExpression()
		if n.Flags&ast.NodeFlagsVibeLang != 0 && binary.OperatorToken.Kind == ast.KindBarToken {
			return c.node(n, "VibePipeExpression").
				set("left", c.convertChild(binary.Left, n)).
				set("right", c.convertChild(binary.Right, n)), true
		}
	case ast.KindLabeledStatement:
		// A match statement's or a select's block, labeled for its arms' breaks.
		if labeled := n.AsLabeledStatement(); synthesized(labeled.Label) {
			return c.convertChild(labeled.Statement, parent), true
		}
	case ast.KindTryStatement:
		if n.Flags&ast.NodeFlagsVibeLang != 0 {
			return c.handleStatement(n), true
		}
	case ast.KindInferType:
		if !inConditionalExtends(n) {
			// D57: infer in a return annotation, which the body supplies.
			return c.node(n, "VibeInferType").set("name", n.AsInferTypeNode().TypeParameter.Name().Text()), true
		}
	case ast.KindCallExpression:
		if result := c.vibeCall(n); result != nil {
			return result, true
		}
	case ast.KindBlock:
		if result := c.vibeBlock(n, parent); result != nil {
			return result, true
		}
	case ast.KindIfStatement:
		// The last clause of a handle statement tests a synthesized true.
		ifStatement := n.AsIfStatement()
		if test := ifStatement.Expression; test.Kind == ast.KindTrueKeyword && synthesized(test) {
			return c.convertChild(ifStatement.ThenStatement, n), true
		}
	case ast.KindVariableStatement:
		if result := c.schemaAlias(n); result != nil { // D280, schema_alias.go
			return result, true
		}
		if result := c.schemaDeclaration(n); result != nil {
			return result, true
		}
	case ast.KindTypeAliasDeclaration:
		if parser.IsDataDeclaration(n) {
			return c.dataDeclaration(n), true // D307, data.go
		}
	case ast.KindModuleDeclaration:
		if parser.IsVibeLangModuleDeclaration(n) {
			return c.moduleDeclaration(n), true
		}
	case ast.KindStringLiteral:
		if parser.IsVibeLangModuleReference(n) && parent != nil && (parent.Kind == ast.KindImportDeclaration || parent.Kind == ast.KindExportDeclaration) {
			return c.moduleReference(n), true
		}
	}
	return nil, false
}

// moduleBodies returns the source file of each module declaration's body
// (D283), by declaration and in the order of the text. The parser gives a
// top-level declaration, the first of its name, a file of its own
// (EmbeddedModules); the checker reports any other (EK4408), whose body is
// parsed here as the parser parses one, so ESLint still lints it.
func moduleBodies(file *ast.SourceFile) (map[*ast.Node]*ast.SourceFile, []*ast.SourceFile) {
	embedded := map[*ast.Node]*ast.SourceFile{}
	for _, body := range file.EmbeddedModules() {
		embedded[body.EmbeddedModule().Declaration] = body
	}
	modules := map[*ast.Node]*ast.SourceFile{}
	var bodies []*ast.SourceFile
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if !parser.IsVibeLangModuleDeclaration(n) {
			return n.ForEachChild(visit)
		}
		body := embedded[n]
		if body == nil {
			body = parseModuleBody(file, n)
		}
		modules[n] = body
		bodies = append(bodies, body)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return modules, bodies
}

// parseModuleBody parses the body of declaration as a TypeScript module in
// the file's text with everything outside the body blanked, so its offsets
// are the file's.
func parseModuleBody(file *ast.SourceFile, declaration *ast.Node) *ast.SourceFile {
	text := file.Text()
	body := parser.ModuleDeclarationBody(file, declaration)
	opts := ast.SourceFileParseOptions{FileName: "/estree.module.ts", PathKey: "/estree.module.ts"}
	opts.ExternalModuleIndicatorOptions.Force = true
	return parser.ParseSourceFile(opts, blank(text[:body.Pos()])+text[body.Pos():body.End()]+blank(text[body.End():]), core.ScriptKindTS)
}

// moduleDeclaration converts module text { body }, whose block the parser
// leaves empty, with the statements of its body's own file.
func (c *converter) moduleDeclaration(n *ast.Node) *obj {
	body := c.modules[n]
	if body == nil {
		c.fail(n)
	}
	module := &converter{file: body, text: body.Text(), scan: scanner.NewScanner(), modules: c.modules}
	module.scan.SetText(module.text)
	block := c.node(n.Body(), "TSModuleBlock").set("body", module.convertBodyExpressions(listNodes(body.Statements), body.AsNode(), nil))
	result := c.node(n, "VibeModuleDeclaration").set("body", block)
	if n.Name().Text() == "" {
		result.set("id", nil) // module { }, which the checker refuses (EK4408)
	} else {
		result.set("id", c.convertChild(n.Name(), n))
	}
	return c.fixExports(n, result)
}

// moduleReference converts an identifier module specifier, from text, as the
// identifier written.
func (c *converter) moduleReference(n *ast.Node) *obj {
	r := c.rangeOf(n)
	name := c.text[r.start:r.end]
	return identifierShape(c.nodeAt(r, "Identifier"), name).set("value", name)
}

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
	if literal := c.schemaBody(fields); literal != nil {
		annotation := c.convertChild(literal, literal.Parent)
		schemaValues(annotation)
		id.set("typeAnnotation", c.nodeAt(c.rangeOf(literal), "TSTypeAnnotation").set("typeAnnotation", annotation))
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
// carries schemaValue, so eslint.mjs marks what it resolves to used:
// typescript-eslint counts typeof in a type as a type use.
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
	return c.node(fields, "ClassBody").set("body", properties)
}

// inConditionalExtends reports whether n, an infer type, is in the extends
// type of a conditional type, where TypeScript reads it.
func inConditionalExtends(n *ast.Node) bool {
	for child, parent := n, n.Parent; parent != nil; child, parent = parent, parent.Parent {
		if parent.Kind == ast.KindConditionalType {
			return parent.AsConditionalTypeNode().ExtendsType == child
		}
		if !ast.IsTypeNode(parent) && parent.Kind != ast.KindTypeParameter && parent.Kind != ast.KindParameter &&
			parent.Kind != ast.KindPropertySignature && parent.Kind != ast.KindNamedTupleMember {
			return false
		}
	}
	return false
}

// handleStatement converts try { body } handle Op(params) { clause }, which
// the parser writes as a try statement whose catch clause tests each clause
// in an if chain, as a try statement whose catch block holds the clauses'
// blocks: the chain tests synthesized names, which rules would compare.
func (c *converter) handleStatement(n *ast.Node) *obj {
	try := n.AsTryStatement()
	result := c.node(n, "TryStatement").
		set("block", c.convertChild(try.TryBlock, n)).
		set("finalizer", c.convertChild(try.FinallyBlock, n))
	clause := try.CatchClause
	if clause == nil {
		return result.set("handler", nil)
	}
	block := clause.AsCatchClause().Block
	var blocks []any
	var chain func(statement *ast.Node)
	chain = func(statement *ast.Node) {
		if statement == nil {
			return
		}
		if statement.Kind == ast.KindIfStatement && synthesized(statement.AsIfStatement().Expression) {
			blocks = append(blocks, c.convertChild(statement.AsIfStatement().ThenStatement, statement))
			chain(statement.AsIfStatement().ElseStatement)
			return
		}
		blocks = append(blocks, c.convertChild(statement, block))
	}
	for _, statement := range block.Statements() {
		chain(statement)
	}
	body := c.node(block, "BlockStatement").set("body", blocks)
	return result.set("handler", c.node(clause, "CatchClause").set("body", body).set("param", nil))
}
