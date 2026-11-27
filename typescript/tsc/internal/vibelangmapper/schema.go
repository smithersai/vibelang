package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// isSchemaDeclaration recognizes the parser's D133 struct initializer, so
// ordinary Schema.Struct calls retain their ordinary expression lowering, and
// a D280 alias, whose declaration the parser flags.
func isSchemaDeclaration(node *ast.Node) bool {
	if node.Kind != ast.KindVariableStatement {
		return false
	}
	declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	return len(declarations) == 1 && declarations[0].Initializer() != nil &&
		(isSchemaAlias(declarations[0]) || declarations[0].Initializer().Kind == ast.KindCallExpression && declarations[0].Initializer().Flags&ast.NodeFlagsVibeLang != 0)
}

// isSchemaAlias reports whether declaration is the constant of a schema alias,
// schema Name = Type (D280), which the parser flags NodeFlagsVibeLang.
func isSchemaAlias(declaration *ast.Node) bool {
	return declaration.Kind == ast.KindVariableDeclaration && declaration.Flags&ast.NodeFlagsVibeLang != 0
}

// isSchemaAliasType identifies a schema alias's synthesized type alias,
// type Name = typeof Name.Type, which is written with the constant.
func isSchemaAliasType(node *ast.Node) bool {
	if node.Kind != ast.KindTypeAliasDeclaration || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	query := node.Type()
	return query != nil && query.Kind == ast.KindTypeQuery && query.AsTypeQueryNode().ExprName.Kind == ast.KindQualifiedName &&
		query.AsTypeQueryNode().ExprName.AsQualifiedName().Right.Text() == "Type"
}

// isSchemaInterface identifies the parser's preceding decoded-type declaration.
// Its text is written together with the constant rather than visited twice.
func isSchemaInterface(node *ast.Node) bool {
	if node.Kind != ast.KindInterfaceDeclaration || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	clauses := node.AsInterfaceDeclaration().HeritageClauses
	if clauses == nil || len(clauses.Nodes) != 1 {
		return false
	}
	types := clauses.Nodes[0].AsHeritageClause().Types.Nodes
	if len(types) != 1 {
		return false
	}
	expression := types[0].Expression()
	return expression.Kind == ast.KindPropertyAccessExpression && expression.Name().Text() == "Type" && expression.Expression().Kind == ast.KindPropertyAccessExpression && expression.Expression().Name().Text() == "Schema"
}

// schemaDeclaration prints the parser's schema expressions in both renderings.
// The decoded interface is a checking witness; deriving it from the value keeps
// optional and mutable keys consistent with the runtime schema.
func (p *projector) schemaDeclaration(node *ast.Node) {
	if isSchemaInterface(node) || isSchemaAliasType(node) {
		return
	}
	declaration := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	name := declaration.Name()
	taggedUnion := parser.IsSchemaTaggedUnion(declaration.Initializer())
	var start int
	var ok bool
	if taggedUnion {
		start, ok = p.schemaDataKeywordStart(node)
	} else {
		start, ok = p.keywordBefore(name, "schema")
	}
	if !ok {
		p.unprojected(node)
		return
	}
	schema := p.names.prelude("Schema")
	exported := ""
	if ast.HasSyntacticModifier(node, ast.ModifierFlagsExport) {
		exported = "export "
	}
	// Export already precedes the replaced keyword, so it belongs to the
	// interface, with a second export preceding the value declaration.
	// VIP-15 foldkit-9: a written type already supplies the witness.
	if schemaHasSynthesizedType(node) {
		if isSchemaAlias(declaration) || taggedUnion {
			// D280 / VIP-74: the type is the schema's decoded type.
			p.plan.witness(start, "type "+name.Text()+" = typeof "+name.Text()+".Type;\n"+exported)
		} else {
			p.plan.witness(start, "interface "+name.Text()+" extends "+schema+".Schema.Type<typeof "+name.Text()+"> {}\n"+exported)
		}
	}
	var pieces schemaPieces
	pieces.write("const ")
	if nameStart := p.tokenStart(name); p.text[nameStart:name.End()] == name.Text() {
		pieces.source(p.text, nameStart, name.End())
	} else {
		pieces.mapped(name.Text(), p.tokenStart(name), name.End()) // a name written with an escape
	}
	pieces.write(" = ")
	p.schemaWrite(&pieces, declaration.Initializer(), schema)
	pieces.write(";")
	p.replacePieces(start, node.End(), pieces)
}

// schemaPiece is generated text, a verbatim source stretch, or the normalized
// spelling of a source token whose range is [pos, end).
type schemaPiece struct {
	text     string
	pos, end int
	atom     bool
}

// schemaPieces is a schema declaration's projected text in order. It keeps
// apart the names the user wrote, the declaration's name, each field name and
// each type reference, so the plan can leave them in place and the span map
// has a segment for each one.
type schemaPieces []schemaPiece

func (s *schemaPieces) write(text string) {
	*s = append(*s, schemaPiece{text: text})
}

func (s *schemaPieces) source(original string, pos int, end int) {
	*s = append(*s, schemaPiece{text: original[pos:end], pos: pos, end: end})
}

func (s *schemaPieces) mapped(text string, pos int, end int) {
	*s = append(*s, schemaPiece{text: text, pos: pos, end: end, atom: true})
}

func (s schemaPieces) String() string {
	var out strings.Builder
	for _, piece := range s {
		out.WriteString(piece.text)
	}
	return out.String()
}

// replacePieces replaces the source text in [start, end) with pieces. Each
// source stretch that follows the one before it stays where it is, and an
// edit replaces only the text between two of them: a diagnostic, a hover or
// a rename at a written name then maps to that name. A stretch out of source
// order is written as text, so the projected text is the same either way.
func (p *projector) replacePieces(start int, end int, pieces schemaPieces) {
	cursor := start
	var written strings.Builder
	flush := func(to int) {
		if written.Len() != 0 || to > cursor {
			p.plan.replace(cursor, to, written.String())
		}
		written.Reset()
	}
	for _, piece := range pieces {
		if piece.end <= piece.pos || piece.pos < cursor || piece.end > end {
			written.WriteString(piece.text)
			continue
		}
		flush(piece.pos)
		if piece.atom {
			p.plan.replaceAtom(piece.pos, piece.end, piece.text)
		}
		cursor = piece.end
	}
	flush(end)
}

// schemaPropertyKey prints the compiler-created own __proto__ field key,
// while retaining source spans and existing diagnostics for written names.
func (p *projector) schemaPropertyKey(name *ast.Node) string {
	if name.Kind == ast.KindComputedPropertyName {
		expression := name.Expression()
		if name.Flags&ast.NodeFlagsVibeLang != 0 && expression.Kind == ast.KindStringLiteral && expression.Text() == "__proto__" {
			return `["__proto__"]`
		}
	}
	if name.Flags&ast.NodeFlagsReparsed == 0 {
		key := p.text[p.tokenStart(name):name.End()]
		if name.Kind == ast.KindComputedPropertyName && p.schemaKeyNeedsCompiler(name, key) {
			p.syntaxDiagnostic(name, CodeUnprojectedForm, "The TypeScript mapper cannot preserve this computed schema key's execution context; build with vibelang.")
		}
		return key
	}
	return "\"\""
}

// Schema field names are runtime object keys. Copy ordinary TypeScript
// expressions, but do not silently erase operations the projector cannot
// lower inside the schema replacement.
func (p *projector) schemaKeyNeedsCompiler(name *ast.Node, key string) bool {
	for _, word := range p.keywords {
		if word.at >= name.Pos() && word.at < name.End() {
			return true
		}
	}
	native := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: tspath.RootedFilePathFromAbsolute("/computed-schema-key.ts"),
	}, "async function* __schemaKey() { const __field = { "+key+": 0 }; }", core.ScriptKindTS)
	if len(native.Diagnostics()) != 0 {
		return true
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindYieldExpression, ast.KindAwaitExpression:
			if schemaKeyEffectFrame(node, false) != nil {
				return true
			}
		case ast.KindThisKeyword:
			if frame := schemaKeyEffectFrame(node, true); frame != nil && (frame.Body() == nil || selfArg(frame.Body()) == "") {
				return true
			}
		case ast.KindSuperKeyword, ast.KindMetaProperty:
			if node.Kind != ast.KindMetaProperty || strings.HasPrefix(p.text[p.tokenStart(node):node.End()], "new") {
				if schemaKeyEffectFrame(node, true) != nil {
					return true
				}
			}
		case ast.KindIdentifier:
			if node.Text() == "arguments" && (node.Parent == nil || node.Parent.Name() != node || node.Parent.Kind == ast.KindShorthandPropertyAssignment) &&
				schemaKeyEffectFrame(node, true) != nil {
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	return visit(name.Expression())
}

func schemaKeyEffectFrame(node *ast.Node, lexical bool) *ast.Node {
	child := node
	for parent := node.Parent; parent != nil; child, parent = parent, parent.Parent {
		// A class member's computed name is evaluated outside its method.
		if ast.IsFunctionLike(parent) {
			if child == parent.Name() {
				continue
			}
			if parent.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				return parent
			}
			if !lexical || parent.Kind != ast.KindArrowFunction {
				return nil
			}
		}
		// Native field initializers and static blocks bind their own this.
		if lexical && (parent.Kind == ast.KindClassStaticBlockDeclaration ||
			parent.Kind == ast.KindPropertyDeclaration && child == parent.Initializer()) {
			return nil
		}
	}
	return nil
}

// schemaExpression serializes only expressions the schema parser creates.
// Unsupported forms and undecidable names are diagnosed at their source span.
func (p *projector) schemaExpression(node *ast.Node, schema string) string {
	var pieces schemaPieces
	p.schemaWrite(&pieces, node, schema)
	return pieces.String()
}

// schemaWrite appends schemaExpression's text to out, with each field name
// and each written type as a source stretch.
func (p *projector) schemaWrite(out *schemaPieces, node *ast.Node, schema string) {
	for _, reference := range p.file.VibeLangSchemaGenerics {
		if reference.Expression == node && reference.Library != nil && p.libraryReference(reference) {
			name := reference.Name
			if ast.IsQualifiedName(name) {
				name = name.AsQualifiedName().Right
			}
			if reference.Arity == 0 && name.Text() == "Error" {
				out.write(schema + ".Defect().pipe(" + schema + ".refine(" + helperRef("$isError") + "))")
				return
			}
			p.schemaWrite(out, reference.Library, schema)
			return
		}
		if reference.Expression == node && reference.Arity == 0 {
			break // a shadowing declaration keeps the written name
		}
		if reference.Expression == node && !reference.Legacy {
			p.schemaDiagnostic(node, "This generic schema needs project type bindings; compile it with vibelang.")
			out.write(schema + ".Unknown")
			return
		}
	}
	if node.Kind == ast.KindPropertyAccessExpression && node.Flags&ast.NodeFlagsVibeLang != 0 {
		if node.Name().Text() == "Never" {
			// The parser marks a non-field in a schema body separately from
			// an unsupported codec type in an alias (VIP-15).
			p.syntaxDiagnostic(node, 1505, "A schema body contains only typed fields; move this member outside the schema.")
		} else {
			p.schemaDiagnostic(node, "This field type has no schema form (EK2109); use an explicit Schema value.")
		}
	}
	switch node.Kind {
	case ast.KindCallExpression:
		p.schemaWrite(out, node.Expression(), schema)
		out.write("(")
		for i, arg := range node.Arguments() {
			if i != 0 {
				out.write(", ")
			}
			p.schemaWrite(out, arg, schema)
		}
		out.write(")")
		return
	case ast.KindPropertyAccessExpression:
		if node.Flags&ast.NodeFlagsReparsed != 0 {
			out.write(schema + "." + node.Name().Text())
			return
		}
		p.checkSchemaName(node)
	case ast.KindObjectLiteralExpression:
		props := node.AsObjectLiteralExpression().Properties.Nodes
		if len(props) == 0 {
			out.write("{}")
			return
		}
		out.write("{ ")
		for i, field := range props {
			if i != 0 {
				out.write(", ")
			}
			name := field.Name()
			key := p.schemaPropertyKey(name)
			if name.Flags&ast.NodeFlagsReparsed == 0 {
				start := p.tokenStart(name)
				written := p.text[start:name.End()]
				switch {
				case key == written:
					out.source(p.text, start, name.End())
				case key == "["+written+"]":
					out.write("[")
					out.source(p.text, start, name.End())
					out.write("]")
				case key == `["`+written+`"]`:
					out.write(`["`)
					out.source(p.text, start, name.End())
					out.write(`"]`)
				default:
					out.mapped(key, start, name.End())
				}
			} else {
				out.write(key)
			}
			out.write(": ")
			p.schemaWrite(out, field.Initializer(), schema)
		}
		out.write(" }")
		return
	case ast.KindArrayLiteralExpression:
		out.write("[")
		for i, value := range node.AsArrayLiteralExpression().Elements.Nodes {
			if i != 0 {
				out.write(", ")
			}
			p.schemaWrite(out, value, schema)
		}
		out.write("]")
		return
	case ast.KindIdentifier:
		p.checkSchemaName(node)
	}
	out.source(p.text, p.tokenStart(node), node.End())
}

// checkSchemaName accepts locally evident schema values and diagnoses names
// whose schema nature requires type information unavailable to the projector.
func (p *projector) checkSchemaName(node *ast.Node) {
	name := p.text[p.tokenStart(node):node.End()]
	if known, _ := p.schemaNameBinding(node, name); !known {
		p.schemaDiagnostic(node, "Cannot establish that "+name+" is a schema (EK2109); provide a schema annotation or an explicit Schema value.")
	}
}

// libraryReference reports whether reference spells a VIP-44 library type
// that no lexical declaration shadows; the projector has no type bindings.
func (p *projector) libraryReference(reference ast.SchemaGenericReference) bool {
	nameNode := reference.Name
	lookup := ""
	if ast.IsQualifiedName(nameNode) {
		qualified := nameNode.AsQualifiedName()
		if !ast.IsIdentifier(qualified.Left) || qualified.Left.Text() != "globalThis" {
			return false
		}
		lookup = "globalThis"
		nameNode = qualified.Right
	}
	if !ast.IsIdentifier(nameNode) {
		return false
	}
	name := nameNode.Text()
	if lookup == "" {
		lookup = name
	}
	switch {
	case reference.Arity == 0:
	case reference.Arity == 1 && name == "ReadonlySet":
	case reference.Arity == 2 && name == "ReadonlyMap":
	default:
		return false
	}
	_, found := p.schemaNameBinding(reference.Expression, lookup)
	return !found
}

// schemaNameBinding finds the lexical declaration of name around node:
// found when one exists, known when it is evidently a schema value.
func (p *projector) schemaNameBinding(node *ast.Node, name string) (known, found bool) {
	// Search lexical scopes from the field outward; a declaration in an
	// unrelated block cannot establish the value of this reference.
	for scope := node.Parent; scope != nil && !found; scope = scope.Parent {
		if ast.IsFunctionLike(scope) {
			for _, parameter := range scope.Parameters() {
				if parameter.Name() != nil && ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == name {
					found = true
				}
			}
		}
		if found {
			break
		}
		if scope.Kind != ast.KindSourceFile && scope.Kind != ast.KindBlock && scope.Kind != ast.KindModuleBlock {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if isSchemaDeclaration(n) {
				d := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
				if d.Name().Text() == name {
					known, found = true, true
				}
				return false
			}
			if n.Kind == ast.KindVariableDeclaration && n.Name() != nil && ast.IsIdentifier(n.Name()) && n.Name().Text() == name {
				found = true
				known = explicitSchemaValue(n.Initializer()) || annotatedSchemaValue(n.Type())
				return false
			}
			if n.Name() != nil && ast.IsIdentifier(n.Name()) && n.Name().Text() == name {
				found = true
			}
			if ast.IsFunctionLike(n) || ast.IsClassLike(n) || n.Kind == ast.KindBlock || n.Kind == ast.KindModuleDeclaration {
				return false
			}
			n.ForEachChild(visit)
			return false
		}
		scope.ForEachChild(visit)
	}
	return known, found
}
