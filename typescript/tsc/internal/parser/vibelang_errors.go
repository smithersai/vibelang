package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Error declarations (D126, D278, D279, D304).
//
// An error declaration declares a named class (D278). The keyword supplies
// only the base class and the tag, the class's own name; every other class
// feature keeps its TypeScript meaning: abstract, extends another error,
// implements, constructors, methods, accessors, override, and static and
// private members. A field is a property written without an initializer,
// with a type, and with no modifier but readonly. A field is readonly unless
// written mutable (D134), and the constructor takes it. Every other member is
// a class member as written.
//
//	error NotFound { id: string }
//	class NotFound extends TaggedError("NotFound")<{ readonly id: string }> {}
//
// A subclass is tagged with its own name:
//
//	error Missing extends NotFound { path: string }
//	class Missing extends $errorSubclass(NotFound, "Missing") {
//	  declare readonly _tag: "Missing"
//	  declare readonly path: string
//	  constructor(args: $ErrorArgs<typeof NotFound, Pick<Missing, "path">>) { super(args) }
//	}
//
// The constructor is written only when the subclass declares fields and no
// constructor of its own. A schema error (D279) is the same with Effect's
// schema classes, its fields mapped to schemas as a schema declaration's are
// (D133):
//
//	schema error FsError { method: string }
//	class FsError extends Schema.TaggedError<FsError>()("FsError", { method: Schema.String }) {}
//
//	schema error Missing extends FsError { path: string }
//	class Missing extends FsError.extend<Missing>("Missing")({ _tag: Schema.tag("Missing"), path: Schema.String }) {}
//
// A field named _tag declares the class's tag type (D304), which the base of
// a family widens so that its subclasses' tags fit: `_tag: string`. The tag
// type of an abstract error is string unless it declares one. The checker
// reports a tag that does not fit (EK2117): a subclass's and its base's tag
// type, or a concrete error's own name and its _tag field. It also reports a
// subclass that declares fields its base's constructor cannot take (EK2118).
//
// A value of a schema error family's base type may be any of its subclasses,
// so the base's schema accepts them too. Each class of a family tells the
// runtime so in a static block: the base of a family, a schema error with a
// _tag field or abstract, runs $schemaErrorFamily, and any other subclass
// $schemaErrorMember:
//
//	class FsError extends Schema.TaggedError<FsError>()("FsError" as string, { method: Schema.String }) {
//	  static { $schemaErrorFamily(this) }
//	}
//	class Missing extends FsError.extend<Missing>("Missing")({ _tag: Schema.tag("Missing"), path: Schema.String }) {
//	  static { $schemaErrorMember(this) }
//	}

// errorDeclaration is what parseErrorDeclaration read.
type errorDeclaration struct {
	modifiers      *ast.ModifierList
	word           core.TextRange // error, or schema for a schema error
	name           *ast.Node
	typeParameters *ast.NodeList
	base           *ast.Node   // the element of the extends clause, or nil
	implements     []*ast.Node // the implements clauses
	fields         []*ast.Node // the fields, in source order, without _tag
	tag            *ast.Node   // the _tag field, or nil
	members        []*ast.Node // every other class element
	mutable        map[*ast.Node]bool
	body           core.TextRange // the braces and what they hold, or the name without a body
	hasBody        bool
	hasConstructor bool
	abstract       bool
	schema         bool
}

// isStartOfVibeLangSchemaError reports whether the current token, schema,
// starts a schema error declaration: schema error Name, with error and the
// name on the same line. A schema named error is still schema error { ... }.
func (p *Parser) isStartOfVibeLangSchemaError() bool {
	return p.lookAhead(func(p *Parser) bool {
		p.nextToken() // schema
		if p.token != ast.KindIdentifier || p.scanner.TokenValue() != "error" || p.hasPrecedingLineBreak() {
			return false
		}
		p.nextToken()
		return !p.hasPrecedingLineBreak() && p.isIdentifier()
	})
}

// parseErrorDeclaration parses an error declaration at the current token,
// error, or, with schema, the schema of a schema error.
func (p *Parser) parseErrorDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, schema bool) *ast.Node {
	d := &errorDeclaration{modifiers: modifiers, word: p.tokenRange(), schema: schema}
	form := VibeSyntax{Kind: VibeSyntaxDeclaration, Name: "error"}
	if schema {
		form.Name = "schema error"
		p.nextToken() // schema
	}
	p.nextToken() // error
	d.name = p.parseBindingIdentifier()
	d.typeParameters = p.parseTypeParameters()
	form.Head = core.NewTextRange(d.word.Pos(), d.name.End())
	d.abstract = modifiers != nil && core.Some(modifiers.Nodes, func(m *ast.Node) bool { return m.Kind == ast.KindAbstractKeyword })
	if clauses := p.parseVibeLangErrorHeritage(); len(clauses) != 0 {
		form.Class = true
		for _, clause := range clauses {
			types := clause.AsHeritageClause().Types.Nodes
			if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
				d.implements = append(d.implements, clause)
				continue
			}
			if d.base != nil || len(types) > 1 {
				p.parseErrorAtRange(clause.Loc, diagnostics.Classes_can_only_extend_a_single_class)
			}
			if d.base == nil && len(types) != 0 {
				d.base = types[0]
			}
		}
	}
	d.body = d.name.Loc
	var elements []*ast.Node
	if p.token == ast.KindOpenBraceToken {
		d.hasBody = true
		start := p.nodePos()
		form.Open = p.tokenRange()
		p.nextToken()
		d.mutable = map[*ast.Node]bool{}
		saveAbstract, saveFieldBody := p.vibelangAbstractMembers, p.vibelangFieldBody // an error inside a service body is not one of its members
		p.vibelangAbstractMembers, p.vibelangFieldBody = false, true
		list := p.parseList(PCClassMembers, func(p *Parser) *ast.Node {
			start := p.nodePos()
			mutable := p.parseVibeLangMutable()
			element := p.parseVibeLangErrorElement()
			if mutable {
				// The field spans its mutable word, as a mutable type member does.
				d.mutable[element] = true
				element.Loc = core.NewTextRange(start, element.End())
			}
			return element
		})
		p.vibelangAbstractMembers, p.vibelangFieldBody = saveAbstract, saveFieldBody
		elements = list.Nodes
		if p.token == ast.KindCloseBraceToken {
			form.Close = p.tokenRange()
		}
		p.parseExpected(ast.KindCloseBraceToken)
		d.body = core.NewTextRange(start, p.nodePos())
	}
	for _, element := range elements {
		switch {
		case isVibeLangErrorField(element) && isVibeLangTagField(element) && d.tag == nil:
			d.tag = element
		case isVibeLangErrorField(element):
			d.fields = append(d.fields, element)
		default:
			if d.mutable[element] {
				p.parseErrorAtRange(element.Loc, diagnostics.X_0_modifier_cannot_appear_on_class_elements_of_this_kind, "mutable")
			}
			if element.Kind == ast.KindConstructor {
				d.hasConstructor = true
			}
			if element.Kind != ast.KindSemicolonClassElement {
				form.Class = true
			}
			d.members = append(d.members, element)
		}
	}
	for _, field := range d.fields {
		name := field.Name()
		if (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "constructor" {
			form.FieldNames = append(form.FieldNames, p.sourceRange(name))
		}
	}
	form.Class = form.Class || d.abstract
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)

	var heritage []*ast.Node
	var members []*ast.Node
	switch {
	case d.base == nil && !schema:
		heritage, members = p.vibelangErrorRoot(d), d.members
	case d.base == nil:
		heritage, members = p.vibelangSchemaErrorRoot(d), d.members
	case !schema:
		heritage, members = p.vibelangErrorSubclass(d)
	default:
		heritage, members = p.vibelangSchemaErrorSubclass(d), d.members
	}
	if registration := p.vibelangSchemaErrorRegistration(d); registration != nil {
		members = append([]*ast.Node{registration}, members...)
	}
	heritage = append(heritage, d.implements...)
	membersLoc := core.NewTextRange(d.body.End(), d.body.End())
	if d.hasBody {
		membersLoc = core.NewTextRange(scanner.SkipTrivia(p.sourceText, d.body.Pos())+1, max(d.body.Pos(), d.body.End()-1))
	}
	// The clauses' list spans each clause written in the source, so the
	// language service finds the base in `extends Base` inside it.
	heritageLoc := d.body
	for _, clause := range heritage {
		if clause.Flags&ast.NodeFlagsReparsed == 0 && clause.Pos() < heritageLoc.Pos() {
			heritageLoc = core.NewTextRange(clause.Pos(), heritageLoc.End())
		}
	}
	result := p.factory.NewClassDeclaration(modifiers, d.name, d.typeParameters, p.newNodeList(heritageLoc, heritage), p.newNodeList(membersLoc, members))
	p.finishNode(result, pos)
	p.withJSDoc(result, jsdoc)
	return result
}

// parseVibeLangErrorHeritage parses an error's extends and implements
// clauses. Unlike a class's, they may end the declaration, which has no body
// when it declares no fields or members: error Timeout extends AppError.
func (p *Parser) parseVibeLangErrorHeritage() []*ast.Node {
	var clauses []*ast.Node
	for p.token == ast.KindExtendsKeyword || p.token == ast.KindImplementsKeyword {
		pos := p.nodePos()
		kind := p.token
		p.nextToken()
		var types []*ast.Node
		for {
			if kind == ast.KindImplementsKeyword {
				types = append(types, p.parseTypeHeritageClauseElement())
			} else {
				types = append(types, p.parseExpressionWithTypeArguments())
			}
			if !p.parseOptional(ast.KindCommaToken) {
				break
			}
		}
		list := p.newNodeList(core.NewTextRange(types[0].Pos(), types[len(types)-1].End()), types)
		clauses = append(clauses, p.finishNode(p.factory.NewHeritageClause(kind, list), pos))
	}
	return clauses
}

// The body of an error, schema error, service, or control declaration is a
// class body (D278, D128), so ; or a new line separates its fields, never a
// comma: error OutOfStock { sku: string, available: number } is EK1013. The
// parser takes a comma after a field there for the next class element, an
// empty member flagged NodeFlagsVibeLang, rather than report TypeScript's
// "Expected '=' for property initializer.", and the checker reports it
// (fieldcommas.go in package vibelang). The comma keeps its TypeScript
// meaning everywhere else, including after a method or an initializer.

// isVibeLangFieldComma reports whether the current token is a comma after a
// field, a property with a type and no initializer, of such a body.
func (p *Parser) isVibeLangFieldComma(typeNode *ast.Node, initializer *ast.Node) bool {
	return p.vibelangFieldBody && p.token == ast.KindCommaToken && typeNode != nil && initializer == nil
}

// parseVibeLangFieldComma parses the comma after a field of such a body as an
// empty class member flagged NodeFlagsVibeLang, for EK1013.
func (p *Parser) parseVibeLangFieldComma() *ast.Node {
	pos := p.nodePos()
	p.vibelangFieldComma = false
	p.nextToken()
	result := p.finishNode(p.factory.NewSemicolonClassElement(), pos)
	result.Flags |= ast.NodeFlagsVibeLang
	return result
}

// parseVibeLangErrorElement gives a typed payload field named constructor
// the shared Field grammar. Ordinary classes still use TypeScript's parser,
// and constructor(...) remains a constructor for its targeted static check.
func (p *Parser) parseVibeLangErrorElement() *ast.Node {
	field := p.lookAhead(func(p *Parser) bool {
		p.parseModifiersEx(true /*allowDecorators*/, true /*permitConstAsModifier*/, true /*stopOnStartOfClassStaticBlock*/)
		if p.token != ast.KindConstructorKeyword {
			return false
		}
		p.nextToken()
		p.parseOptional(ast.KindQuestionToken)
		return p.token == ast.KindColonToken
	})
	if !field {
		return p.parseClassElement()
	}
	pos := p.nodePos()
	jsdoc := p.jsdocScannerInfo()
	modifiers := p.parseModifiersEx(true /*allowDecorators*/, true /*permitConstAsModifier*/, true /*stopOnStartOfClassStaticBlock*/)
	return p.parsePropertyOrMethodDeclaration(pos, jsdoc, modifiers)
}

// isVibeLangErrorField reports whether element, a member of an error
// declaration's body, is a field: a property with a type and no initializer
// whose only modifier, if any, is readonly.
func isVibeLangErrorField(element *ast.Node) bool {
	if element.Kind != ast.KindPropertyDeclaration || element.Initializer() != nil || element.Type() == nil ||
		ast.IsPrivateIdentifier(element.Name()) || ast.IsComputedPropertyName(element.Name()) {
		return false
	}
	if postfix := element.PostfixToken(); postfix != nil && postfix.Kind == ast.KindExclamationToken {
		return false
	}
	if modifiers := element.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if modifier.Kind != ast.KindReadonlyKeyword {
				return false
			}
		}
	}
	return true
}

// isVibeLangTagField reports whether field is named _tag, the field that
// declares an error's tag type.
func isVibeLangTagField(field *ast.Node) bool {
	name := field.Name()
	return (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "_tag"
}

// vibelangErrorFieldSignatures returns the fields as the property signatures
// of a type literal: readonly unless written mutable, with their comments.
func (p *Parser) vibelangErrorFieldSignatures(d *errorDeclaration, fields []*ast.Node) []*ast.Node {
	signatures := make([]*ast.Node, 0, len(fields))
	for _, field := range fields {
		modifiers := field.Modifiers()
		if !d.mutable[field] {
			modifiers = p.vibelangReadonly(modifiers, field.Name().Loc)
		}
		signature := p.factory.NewPropertySignatureDeclaration(modifiers, field.Name(), field.PostfixToken(), field.Type(), nil /*initializer*/)
		signature.Loc = field.Loc
		signature.Flags |= field.Flags & (ast.NodeFlagsHasJSDoc | ast.NodeFlagsPossiblyContainsDeprecatedTag | p.contextFlags)
		p.overrideParentInImmediateChildren(signature)
		p.vibelangMoveJSDoc(field, signature)
		signatures = append(signatures, signature)
	}
	return signatures
}

// vibelangMoveJSDoc gives to the comments that the parser read eagerly for
// from, the node that to replaces.
func (p *Parser) vibelangMoveJSDoc(from *ast.Node, to *ast.Node) {
	for i := range p.jsdocInfos {
		if p.jsdocInfos[i].parent == from {
			p.jsdocInfos[i].parent = to
			for _, comment := range p.jsdocInfos[i].jsDocs {
				comment.Parent = to
			}
		}
	}
}

// vibelangErrorFields returns the type literal of the fields with the _tag
// field among them in source order, synthesized and empty when there are none.
func (p *Parser) vibelangErrorFields(d *errorDeclaration) *ast.Node {
	fields := d.fields
	if d.tag != nil {
		fields = append([]*ast.Node{d.tag}, fields...)
		slicesSortByPos(fields)
	}
	if len(fields) == 0 {
		return p.vibelangSynthesized(p.factory.NewTypeLiteralNode(p.newNodeList(d.name.Loc, nil)), d.name.Loc)
	}
	// From the first field's token, so a comment before it stays the field's.
	loc := core.NewTextRange(scanner.SkipTrivia(p.sourceText, fields[0].Pos()), fields[len(fields)-1].End())
	return p.vibelangSpanning(p.factory.NewTypeLiteralNode(p.newNodeList(loc, p.vibelangErrorFieldSignatures(d, fields))), loc)
}

// slicesSortByPos sorts nodes by position, which keeps two lists of one
// body's members in source order once merged.
func slicesSortByPos(nodes []*ast.Node) {
	for i := 1; i < len(nodes); i++ {
		for j := i; j > 0 && nodes[j].Pos() < nodes[j-1].Pos(); j-- {
			nodes[j], nodes[j-1] = nodes[j-1], nodes[j]
		}
	}
}

// vibelangErrorTag returns the tag a declaration passes to its base: its name
// as a string literal, written `"Name" as string` for an abstract error
// without a _tag field, or `"Name" as T` when typeNode, a _tag field's type,
// is not nil.
func (p *Parser) vibelangErrorTag(d *errorDeclaration, typeNode *ast.Node) *ast.Node {
	tag := p.vibelangSynthesized(p.factory.NewStringLiteral(d.name.Text(), ast.TokenFlagsNone), d.name.Loc)
	switch {
	case typeNode != nil:
		return p.vibelangSpanning(p.factory.NewAsExpression(tag, typeNode), typeNode.Loc)
	case d.abstract:
		return p.vibelangSynthesized(p.factory.NewAsExpression(tag, p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindStringKeyword), d.name.Loc)), d.name.Loc)
	}
	return tag
}

// vibelangErrorHeritage returns the extends clause of base, an expression
// with type arguments that spans loc.
func (p *Parser) vibelangErrorHeritage(base *ast.Node, loc core.TextRange) []*ast.Node {
	clause := p.vibelangSpanning(p.factory.NewHeritageClause(ast.KindExtendsKeyword, p.newNodeList(loc, []*ast.Node{base})), loc)
	return []*ast.Node{clause}
}

// vibelangErrorRoot writes the base of an error without extends:
// TaggedError("Name")<{ fields }>, or TaggedError("Name" as T)<{ fields }>
// with a _tag field of type T.
func (p *Parser) vibelangErrorRoot(d *errorDeclaration) []*ast.Node {
	fields := p.vibelangErrorFields(d)
	callee := p.vibelangIntrinsic("TaggedError", d.name.Loc)
	var tagType *ast.Node
	if d.tag != nil {
		// The field stays among the fields, which Readonly<A> gives the
		// instance, so the tag's type is a copy of its type.
		tagType = p.addDeepCloneReparse(d.tag.Type())
	}
	tag := p.vibelangErrorTag(d, tagType)
	call := p.vibelangSynthesized(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(d.name.Loc, []*ast.Node{tag}), ast.NodeFlagsNone), d.name.Loc)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(call, p.newNodeList(fields.Loc, []*ast.Node{fields})), fields.Loc)
	return p.vibelangErrorHeritage(base, fields.Loc)
}

// vibelangErrorSelf returns the class's own type, Name<T, ...>, synthesized
// on its name, for a schema class's Self type argument and Pick.
func (p *Parser) vibelangErrorSelf(d *errorDeclaration) *ast.Node {
	var arguments *ast.NodeList
	if d.typeParameters != nil {
		references := make([]*ast.Node, len(d.typeParameters.Nodes))
		for i, parameter := range d.typeParameters.Nodes {
			name := p.vibelangSynthesized(p.factory.NewIdentifier(parameter.Name().Text()), d.name.Loc)
			references[i] = p.vibelangSynthesized(p.factory.NewTypeReferenceNode(name, nil), d.name.Loc)
		}
		arguments = p.newNodeList(d.name.Loc, references)
	}
	name := p.vibelangSynthesized(p.factory.NewIdentifier(d.name.Text()), d.name.Loc)
	return p.vibelangSynthesized(p.factory.NewTypeReferenceNode(name, arguments), d.name.Loc)
}

// vibelangSchemaErrorFields returns the object of a schema error's field
// schemas, flagged NodeFlagsVibeLang so the checker reports a field with no
// schema form (EK2109), with first, when not nil, before them.
func (p *Parser) vibelangSchemaErrorFields(d *errorDeclaration, first *ast.Node) *ast.Node {
	properties := p.vibelangSchemaProperties(p.vibelangErrorFieldSignatures(d, d.fields))
	if first != nil {
		properties = append([]*ast.Node{first}, properties...)
	}
	object := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(d.body, properties), true /*multiLine*/), d.body)
	object.Flags |= ast.NodeFlagsVibeLang
	return object
}

// vibelangSchemaErrorRoot writes the base of a schema error without extends:
// Schema.TaggedError<Name>()("Name", { field schemas }).
func (p *Parser) vibelangSchemaErrorRoot(d *errorDeclaration) []*ast.Node {
	var tagType *ast.Node
	if d.tag != nil {
		tagType = d.tag.Type()
	}
	factory := p.vibelangSchemaMember(nil, "TaggedError", d.word)
	self := p.vibelangErrorSelf(d)
	inner := p.vibelangSynthesized(p.factory.NewCallExpression(factory, nil, p.newNodeList(d.name.Loc, []*ast.Node{self}), p.newNodeList(d.word, nil), ast.NodeFlagsNone), d.word)
	tag := p.vibelangErrorTag(d, tagType)
	fields := p.vibelangSchemaErrorFields(d, nil)
	call := p.vibelangSpanning(p.factory.NewCallExpression(inner, nil, nil, p.newNodeList(d.body, []*ast.Node{tag, fields}), ast.NodeFlagsNone), d.body)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(call, nil), d.body)
	return p.vibelangErrorHeritage(base, d.body)
}

// vibelangSchemaErrorSubclass writes the base of a schema error that extends
// another: Base.extend<Name>("Name")({ _tag: Schema.tag("Name"), field schemas }).
func (p *Parser) vibelangSchemaErrorSubclass(d *errorDeclaration) []*ast.Node {
	expression := d.base.Expression()
	var tagType *ast.Node
	if d.tag != nil {
		tagType = d.tag.Type()
	}
	extend := p.vibelangSchemaMember(expression, "extend", expression.Loc)
	extend.Loc = expression.Loc
	extend.Flags &^= ast.NodeFlagsReparsed // it holds the source expression
	identifier := p.vibelangSynthesized(p.factory.NewStringLiteral(d.name.Text(), ast.TokenFlagsNone), d.name.Loc)
	inner := p.vibelangSpanning(p.factory.NewCallExpression(extend, nil, p.newNodeList(d.name.Loc, []*ast.Node{p.vibelangErrorSelf(d)}), p.newNodeList(d.name.Loc, []*ast.Node{identifier}), ast.NodeFlagsNone), expression.Loc)
	tagName := p.vibelangSynthesized(p.factory.NewIdentifier("_tag"), d.name.Loc)
	tagSchema := p.vibelangSchemaCall("tag", d.name.Loc, p.vibelangErrorTag(d, tagType))
	tag := p.vibelangSpanning(p.factory.NewPropertyAssignment(nil, tagName, nil, nil, tagSchema), tagSchema.Loc)
	fields := p.vibelangSchemaErrorFields(d, tag)
	call := p.vibelangSpanning(p.factory.NewCallExpression(inner, nil, nil, p.newNodeList(d.body, []*ast.Node{fields}), ast.NodeFlagsNone), core.NewTextRange(expression.Pos(), d.body.End()))
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(call, d.base.AsExpressionWithTypeArguments().TypeArguments), d.base.Loc)
	return p.vibelangErrorHeritage(base, d.base.Loc)
}

// vibelangSchemaErrorRegistration returns the static block through which a
// schema error joins its family (D304): static { $schemaErrorFamily(this) }
// for the base of a family, a schema error with a _tag field or abstract, and
// static { $schemaErrorMember(this) } for any other subclass. It returns nil
// for any other declaration. The block comes first among the members, so the
// class has joined its family before its own static initializers run.
func (p *Parser) vibelangSchemaErrorRegistration(d *errorDeclaration) *ast.Node {
	var helper string
	switch {
	case !d.schema:
		return nil
	case d.tag != nil || d.abstract:
		helper = "$schemaErrorFamily"
	case d.base != nil:
		helper = "$schemaErrorMember"
	default:
		return nil
	}
	at := d.name.Loc
	callee := p.vibelangIntrinsic(helper, at)
	this := p.vibelangSynthesized(p.factory.NewKeywordExpression(ast.KindThisKeyword), at)
	call := p.vibelangSynthesized(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(at, []*ast.Node{this}), ast.NodeFlagsNone), at)
	statement := p.vibelangSynthesized(p.factory.NewExpressionStatement(call), at)
	body := p.vibelangSynthesized(p.factory.NewBlock(p.newNodeList(at, []*ast.Node{statement}), true /*multiLine*/), at)
	return p.vibelangSynthesized(p.factory.NewClassStaticBlockDeclaration(nil, body), at)
}

// vibelangErrorSubclass writes the base and the members of an error that
// extends another: $errorSubclass(Base, "Name") with the tag's declare
// member, the fields as declare members, and, when it declares fields and no
// constructor, a constructor that takes them with what the base takes.
func (p *Parser) vibelangErrorSubclass(d *errorDeclaration) ([]*ast.Node, []*ast.Node) {
	expression := d.base.Expression()
	callee := p.vibelangIntrinsic("$errorSubclass", expression.Loc)
	tag := p.vibelangSynthesized(p.factory.NewStringLiteral(d.name.Text(), ast.TokenFlagsNone), d.name.Loc)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil, nil, p.newNodeList(expression.Loc, []*ast.Node{expression, tag}), ast.NodeFlagsNone), expression.Loc)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(call, d.base.AsExpressionWithTypeArguments().TypeArguments), d.base.Loc)
	heritage := p.vibelangErrorHeritage(base, d.base.Loc)

	var members []*ast.Node
	if d.tag != nil {
		members = append(members, p.vibelangDeclareField(d, d.tag))
	} else {
		var tagType *ast.Node
		if d.abstract {
			tagType = p.factory.NewKeywordTypeNode(ast.KindStringKeyword)
		} else {
			tagType = p.factory.NewLiteralTypeNode(p.vibelangSynthesized(p.factory.NewStringLiteral(d.name.Text(), ast.TokenFlagsNone), d.name.Loc))
		}
		tagType = p.vibelangSynthesized(tagType, d.name.Loc)
		modifiers := p.vibelangModifiers(nil, d.name, ast.KindDeclareKeyword, ast.KindReadonlyKeyword)
		name := p.vibelangSynthesized(p.factory.NewIdentifier("_tag"), d.name.Loc)
		member := p.vibelangSynthesized(p.factory.NewPropertyDeclaration(modifiers, name, nil, tagType, nil), d.name.Loc)
		member.Flags |= ast.NodeFlagsAmbient // declare, as the parser marks a member it reads with declare
		members = append(members, member)
	}
	for _, field := range d.fields {
		members = append(members, p.vibelangDeclareField(d, field))
	}
	if len(d.fields) != 0 && !d.hasConstructor {
		if constructor := p.vibelangErrorConstructor(d, expression); constructor != nil {
			members = append(members, constructor)
		}
	}
	return heritage, append(members, d.members...)
}

// vibelangDeclareField makes field, a subclass's field, a declare member,
// readonly unless written mutable: the base's constructor, or the subclass's,
// sets it.
func (p *Parser) vibelangDeclareField(d *errorDeclaration, field *ast.Node) *ast.Node {
	modifiers := p.vibelangModifiers(field.Modifiers(), field.Name(), ast.KindDeclareKeyword)
	if !d.mutable[field] {
		modifiers = p.vibelangReadonly(modifiers, field.Name().Loc)
	}
	field.AsMutable().SetModifiers(modifiers)
	field.Flags |= ast.NodeFlagsAmbient
	p.overrideParentInImmediateChildren(field)
	return field
}

// vibelangErrorConstructor writes the constructor of a subclass that declares
// fields and no constructor:
//
//	constructor(args: $ErrorArgs<typeof Base, Pick<Name, "field" | ...>>) { super(args) }
//
// or returns nil when the base is not an entity name, which typeof needs. A
// base written with type arguments, `extends Base<number>`, is queried as
// `typeof Base<number>`, so the constructor takes what the instantiated base
// takes.
func (p *Parser) vibelangErrorConstructor(d *errorDeclaration, expression *ast.Node) *ast.Node {
	at := d.name.Loc
	entity := p.vibelangSynthesizedEntityName(expression, at)
	if entity == nil {
		return nil
	}
	keys := make([]*ast.Node, len(d.fields))
	for i, field := range d.fields {
		key := p.vibelangSynthesized(p.factory.NewStringLiteral(field.Name().Text(), ast.TokenFlagsNone), at)
		keys[i] = p.vibelangSynthesized(p.factory.NewLiteralTypeNode(key), at)
	}
	var keyType *ast.Node
	if len(keys) == 1 {
		keyType = keys[0]
	} else {
		keyType = p.vibelangSynthesized(p.factory.NewUnionTypeNode(p.newNodeList(at, keys)), at)
	}
	pick := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.vibelangSynthesized(p.factory.NewIdentifier("Pick"), at), p.newNodeList(at, []*ast.Node{p.vibelangErrorSelf(d), keyType})), at)
	var typeArguments *ast.NodeList
	if written := d.base.AsExpressionWithTypeArguments().TypeArguments; written != nil {
		clones := make([]*ast.Node, len(written.Nodes))
		for i, argument := range written.Nodes {
			clones[i] = p.addDeepCloneReparse(argument)
		}
		typeArguments = p.newNodeList(written.Loc, clones)
	}
	query := p.vibelangSynthesized(p.factory.NewTypeQueryNode(entity, typeArguments), at)
	argsType := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.vibelangSynthesized(p.factory.NewIdentifier("$ErrorArgs"), at), p.newNodeList(at, []*ast.Node{query, pick})), at)
	parameter := p.vibelangSynthesized(p.factory.NewParameterDeclaration(nil, nil, p.vibelangSynthesized(p.factory.NewIdentifier("args"), at), nil, argsType, nil), at)
	super := p.vibelangSynthesized(p.factory.NewKeywordExpression(ast.KindSuperKeyword), at)
	argument := p.vibelangSynthesized(p.factory.NewIdentifier("args"), at)
	superCall := p.vibelangSynthesized(p.factory.NewCallExpression(super, nil, nil, p.newNodeList(at, []*ast.Node{argument}), ast.NodeFlagsNone), at)
	statement := p.vibelangSynthesized(p.factory.NewExpressionStatement(superCall), at)
	body := p.vibelangSynthesized(p.factory.NewBlock(p.newNodeList(at, []*ast.Node{statement}), true /*multiLine*/), at)
	return p.vibelangSynthesized(p.factory.NewConstructorDeclaration(nil, nil, p.newNodeList(at, []*ast.Node{parameter}), nil, nil, body), at)
}

// vibelangSynthesizedEntityName returns the entity name that names the same
// value as expression, an identifier or a property access of one, built of
// new identifiers at anchor, or nil for any other expression.
func (p *Parser) vibelangSynthesizedEntityName(expression *ast.Node, anchor core.TextRange) *ast.Node {
	switch {
	case ast.IsIdentifier(expression):
		return p.vibelangSynthesized(p.factory.NewIdentifier(expression.Text()), anchor)
	case ast.IsPropertyAccessExpression(expression) && ast.IsIdentifier(expression.Name()):
		left := p.vibelangSynthesizedEntityName(expression.Expression(), anchor)
		if left == nil {
			return nil
		}
		right := p.vibelangSynthesized(p.factory.NewIdentifier(expression.Name().Text()), anchor)
		return p.vibelangSynthesized(p.factory.NewQualifiedName(left, right), anchor)
	}
	return nil
}
