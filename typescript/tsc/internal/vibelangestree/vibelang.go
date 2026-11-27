package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The parser writes each VibeLang form as the TypeScript it abbreviates
// (internal/parser/vibelang*.go), and most of that TypeScript is also the
// right thing for a rule to read: an effect block's builder contains a lexical
// function that starts its own code path, a do expression returns its completion
// value, and an error is a class. The forms below would mislead a rule as TypeScript,
// so they convert to node types of their own, each with visitor keys
// (packages/compiler/eslint.mjs) so rules and scope analysis still reach
// every source node inside them:
//
//	A!E!R                  VibeEffectType { success, failure, requirements }
//	A!infer E              VibeInferType { name }, outside a conditional type
//	x |> f(%)              VibePipeExpression { left, right }, TopicReference
//	x catch (e) => y       VibeCatchExpression { expression, handler }
//	pattern binding step   VibePatternAssignment { expression: AssignmentExpression }
//	pattern type test      VibePatternTypeTest { argument }
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
	// generic data declaration's interface; a data declaration's constant (D307);
	// a schema service's Rpc group class (VIP-57).
	return c.vibe && ((statement.Kind == ast.KindInterfaceDeclaration || statement.Kind == ast.KindTypeAliasDeclaration) && synthesized(statement) || parser.IsDataConstructors(statement) || parser.IsSchemaServiceGroup(statement))
}

func (c *converter) convertVibeLang(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if !c.vibe {
		return nil, false
	}
	// Iterator cleanup is compiler bookkeeping, outside the source condition.
	// Keep the checked pattern assignments visible to scope analysis.
	if parser.VibeLangMatchCacheCondition(n) != nil {
		return c.convertChild(n.Expression().AsBinaryExpression().Left, parent), true
	}
	if result, ok := c.convertVibeExpression(n, parent); ok {
		return result, true
	}
	return c.convertVibeStatementOrDecl(n, parent)
}

func (c *converter) convertVibeExpression(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindTypeOfExpression:
		// Record and primitive-extractor patterns synthesize typeof tests at
		// the pattern's token. Source lint rules must see the pattern test,
		// while an authored typeof (including in a guard or key) stays unary.
		if _, kind := c.tokenAfter(c.start(n)); kind != ast.KindTypeOfKeyword {
			return c.node(n, "VibePatternTypeTest").set("argument", c.convertChild(n.Expression(), n)), true
		}
	case ast.KindIdentifier:
		if n.Flags&ast.NodeFlagsVibeLang != 0 && n.Text() == "%" {
			return c.node(n, "TopicReference"), true
		}
	case ast.KindTypeReference:
		if effect := c.effectType(n); effect != nil {
			return effect, true
		}
	case ast.KindBinaryExpression:
		return c.convertVibeBinary(n)
	case ast.KindInferType:
		if !inConditionalExtends(n) {
			// D57: infer in a return annotation, which the body supplies.
			return c.node(n, "VibeInferType").set("name", n.AsInferTypeNode().TypeParameter.Name().Text()), true
		}
	case ast.KindCallExpression:
		if result := c.vibeCall(n); result != nil {
			return result, true
		}
	case ast.KindTaggedTemplateExpression:
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return c.triedTaggedTemplate(n), true
		}
	case ast.KindStringLiteral:
		if parser.IsVibeLangModuleReference(n) && parent != nil && (parent.Kind == ast.KindImportDeclaration || parent.Kind == ast.KindExportDeclaration) {
			return c.moduleReference(n), true
		}
	}
	return nil, false
}

func (c *converter) convertVibeBinary(n *ast.Node) (*obj, bool) {
	binary := n.AsBinaryExpression()
	if parser.VibeLangMatchCacheFinish(n) != nil {
		return c.convertChild(binary.Left, n), true
	}
	var assignment *ast.Node
	if binary.Left != nil {
		assignment = ast.SkipParentheses(binary.Left)
	}
	// A pattern step assigns a subject/extraction/binding, then yields
	// synthetic true so the next test runs. It is not a source comma
	// expression whose constant truthiness ESLint should report (VIP-34).
	if binary.OperatorToken != nil && binary.OperatorToken.Kind == ast.KindCommaToken && synthesized(binary.OperatorToken) &&
		binary.Right != nil && binary.Right.Kind == ast.KindTrueKeyword && synthesized(binary.Right) &&
		assignment != nil && assignment.Kind == ast.KindBinaryExpression && assignment.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken {
		return c.node(n, "VibePatternAssignment").set("expression", c.convertChild(binary.Left, n)), true
	}
	if n.Flags&ast.NodeFlagsVibeLang != 0 && binary.OperatorToken != nil && binary.OperatorToken.Kind == ast.KindBarToken {
		return c.node(n, "VibePipeExpression").
			set("left", c.convertChild(binary.Left, n)).
			set("right", c.convertChild(binary.Right, n)), true
	}
	// A non-binding `x is P` test lowers to a synthesized comparison whose
	// span sits on P while Left is the source subject before `is`. Expose
	// it as VibeIsExpression spanning subject through pattern so ESLint
	// rules never see a BinaryExpression with Left outside its range.
	if binary.OperatorToken != nil && synthesized(binary.OperatorToken) && binary.Left != nil && !synthesized(binary.Left) && binary.Right != nil {
		if _, tokKind := c.tokenAfter(binary.Left.End()); tokKind == ast.KindIsKeyword {
			left := c.convertChild(binary.Left, n)
			right := c.convertChild(binary.Right, n)
			end := c.rangeOf(n).end
			if right != nil && right.rng().end > end {
				end = right.rng().end
			}
			return c.nodeAt(span{left.rng().start, end}, "VibeIsExpression").
				set("subject", left).
				set("pattern", right), true
		}
	}
	return nil, false
}

func (c *converter) convertVibeStatementOrDecl(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindExpressionStatement:
		if result := c.concurrentStatement(n); result != nil {
			return result, true
		}
	case ast.KindLabeledStatement:
		return c.convertVibeLabeled(n)
	case ast.KindBreakStatement:
		if label := n.AsBreakStatement().Label; synthesized(label) {
			return c.node(n, "BreakStatement").set("label", nil).set("synthesized", true), true
		}
	case ast.KindTryStatement:
		if n.Flags&ast.NodeFlagsVibeLang != 0 {
			return c.handleStatement(n), true
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
	}
	return nil, false
}

func (c *converter) convertVibeLabeled(n *ast.Node) (*obj, bool) {
	if result := c.concurrentHead(n); result != nil {
		return result, true
	}
	// Match arms leave a generated block with a labeled break. A single
	// default case keeps that exit in ESLint's control-flow graph without
	// exposing a label the author did not write.
	if labeled := n.AsLabeledStatement(); synthesized(labeled.Label) {
		body := c.convertChild(labeled.Statement, n)
		start := c.start(n)
		discriminant := c.nodeAt(span{start, start}, "Literal").set("value", 0).set("raw", "0").set("synthesized", true)
		clause := c.node(n, "SwitchCase").set("test", nil).set("consequent", []any{body})
		sw := c.node(n, "SwitchStatement").set("discriminant", discriminant).set("cases", []any{clause})
		if body != nil {
			fixParentLocation(clause, body.rng())
			fixParentLocation(sw, body.rng())
		}
		return sw, true
	}
	return nil, false
}

// moduleBodies returns the source file of each module declaration's body
// (D283), by declaration and in the order of the text. The parser gives a
// top-level declaration, the first of its name, a file of its own
// (EmbeddedModules); the checker reports misplaced or duplicate declarations (EK4001/EK4002/EK4005), whose body is
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
	kind := core.ScriptKindTS
	if file.LanguageVariant == core.LanguageVariantJSX {
		kind = core.ScriptKindTSX
		opts.FileName, opts.PathKey = "/estree.module.tsx", "/estree.module.tsx"
	}
	return parser.ParseSourceFile(opts, blank(text[:body.Pos()])+text[body.Pos():body.End()]+blank(text[body.End():]), kind)
}

// moduleDeclaration converts module text { body }, whose block the parser
// leaves empty, with the statements of its body's own file.
func (c *converter) moduleDeclaration(n *ast.Node) *obj {
	body := c.modules[n]
	if body == nil {
		return c.fail(n)
	}
	module := &converter{file: body, text: body.Text(), scan: scanner.NewScanner(), modules: c.modules}
	module.scan.SetText(module.text)
	block := c.node(n.Body(), "TSModuleBlock").set("body", module.convertBodyExpressions(listNodes(body.Statements), body.AsNode(), nil))
	if module.err != nil {
		c.recordError(module.err.pos, module.err.message)
		return nil
	}
	result := c.node(n, "VibeModuleDeclaration").set("body", block)
	if n.Name().Text() == "" {
		result.set("id", nil) // module { }, which the checker refuses (EK4003)
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

// An effect block is a program value, not a function argument. Preserve its
// deferred lexical function for scopes and code-path analysis under the
// intrinsic builder call, as Effect.gen does in TypeScript (VIP-2). Exposing
// the arrow directly makes a handler-arity selector mistake the program
// argument of Effect.catchCause for its handler (Smithers Egress).
func (c *converter) effectBlockValue(n *ast.Node, arrow *obj) *obj {
	keyword, _ := c.tokenAfter(n.Pos())
	callee := identifierShape(c.nodeAt(keyword, "Identifier"), "$effect").set("synthesized", true)
	return c.node(n, "CallExpression").
		set("callee", callee).
		set("arguments", []any{arrow}).
		set("optional", false)
}
