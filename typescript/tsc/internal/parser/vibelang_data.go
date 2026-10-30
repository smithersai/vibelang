package parser

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Data declarations (D307): a tagged union whose values Effect's
// Data.taggedEnum constructs.
//
//	data Delivery {
//	  Waiting
//	  Sent { tracking: string }
//	}
//
// parses as the declarations Effect's documentation writes for it:
//
//	const Delivery: Data.TaggedEnum.Constructor<Delivery> = Data.taggedEnum<Delivery>()
//	type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { readonly tracking: string } }>
//
// The constant's type is the one Data.taggedEnum returns, written out so that
// a declaration file names it, Data.TaggedEnum.Constructor<Delivery>, rather
// than expanding it, which TypeScript cannot do for a recursive data type
// (TS5088).
//
// A data type with type parameters passes them through the interface that
// Data.TaggedEnum.WithGenerics describes, named for the type:
//
//	interface LoadStateDefinition extends Data.TaggedEnum.WithGenerics<2> {
//	  readonly taggedEnum: LoadState<this["A"], this["B"]>
//	}
//	const LoadState: {
//	  readonly [Tag in LoadStateDefinition["taggedEnum"]["_tag"]]: <A, B>(
//	    args: Data.TaggedEnum.Args<Data.TaggedEnum.Kind<LoadStateDefinition, A, B>, Tag>
//	  ) => Data.TaggedEnum.Value<Data.TaggedEnum.Kind<LoadStateDefinition, A, B>, Tag>
//	} & Data.TaggedEnum.GenericMatchers<LoadStateDefinition> = Data.taggedEnum<LoadStateDefinition>()
//	type LoadState<A, E> = Data.TaggedEnum<{ Idle: {}; Loaded: { readonly value: A } }>
//
// The type alias holds the source: the modifiers, the name, the type
// parameters, and each variant as a property of the type literal that
// Data.TaggedEnum takes. A variant's type is its body, parsed as a type
// literal, or {} for a variant without one. The alias is flagged
// NodeFlagsVibeLang, which is how the checker and the tools tell it from a
// type alias written out (IsDataDeclaration). The constant and the interface
// go to p.reparseList, so the statement list holds them before the alias,
// which spans the whole declaration.
//
// The checker reports what the parser accepts and a data type cannot hold
// (data.go in package vibelang): no variants (EK2122), a variant declared
// twice (EK2123), a variant named $is or $match or a field named _tag
// (EK2124), a member of a variant that is not a field (EK2125), more than
// four type parameters (EK2801), a constrained one (EK2126), and a comma after a
// variant or a field (EK1013). A variant, like a member of a type literal,
// ends with its separator, so the checker reads the comma there.

// VibeSyntaxData is the Name of the VibeSyntaxDeclaration recorded for a
// data declaration: Head runs from data through the name, Open and Close are
// the braces, and Variants lists the variants.
const VibeSyntaxData = "data"

// scanDataName reports whether the current token, the identifier after data,
// starts the rest of a data declaration: the name, then { or, on the same
// line, <. It moves the scanner; call it through lookAhead.
func (p *Parser) scanDataName() bool {
	if !p.isIdentifier() {
		return false
	}
	p.nextToken()
	return p.token == ast.KindOpenBraceToken || p.token == ast.KindLessThanToken && !p.hasPrecedingLineBreak()
}

// parseDataDeclaration parses data Name<T> { Variant; Variant { fields } }.
func (p *Parser) parseDataDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	keyword := p.tokenRange()
	p.nextToken() // data
	name := p.parseBindingIdentifier()
	typeParameters := p.parseTypeParameters()
	form := VibeSyntax{Kind: VibeSyntaxDeclaration, Name: VibeSyntaxData, Head: core.NewTextRange(keyword.Pos(), name.End())}
	bodyStart := p.nodePos()
	var variants []*ast.Node
	if p.token == ast.KindOpenBraceToken {
		form.Open = p.tokenRange()
	}
	if p.parseExpected(ast.KindOpenBraceToken) {
		for p.token != ast.KindCloseBraceToken && p.token != ast.KindEndOfFile {
			if p.parseOptional(ast.KindSemicolonToken) {
				continue
			}
			if variant := p.parseDataVariant(&form); variant != nil {
				variants = append(variants, variant)
			}
		}
		if p.token == ast.KindCloseBraceToken {
			form.Close = p.tokenRange()
		}
		p.parseExpected(ast.KindCloseBraceToken)
	}
	body := core.NewTextRange(bodyStart, p.nodePos())
	if body.Len() == 0 {
		body = name.Loc
	}
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)

	// type Name<T> = Data.TaggedEnum<{ Variant: { fields } }>
	literal := p.vibelangSpanning(p.factory.NewTypeLiteralNode(p.newNodeList(body, variants)), body)
	taggedEnum := p.vibelangSynthesized(p.factory.NewQualifiedName(p.mIdent("Data", keyword), p.mIdent("TaggedEnum", keyword)), keyword)
	typeNode := p.vibelangSpanning(p.factory.NewTypeReferenceNode(taggedEnum, p.newNodeList(body, []*ast.Node{literal})), body)
	alias := p.factory.NewTypeAliasDeclaration(modifiers, name, typeParameters, typeNode)
	p.finishNode(alias, pos)
	alias.Flags |= ast.NodeFlagsVibeLang
	p.withJSDoc(alias, jsdoc)

	// interface NameDefinition extends Data.TaggedEnum.WithGenerics<N> { readonly taggedEnum: Name<this["A"], ...> }
	constructed := name.Text()
	if typeParameters != nil && len(typeParameters.Nodes) != 0 {
		constructed = DataDefinitionName(name.Text())
		p.reparseList = append(p.reparseList, p.dataDefinition(name, typeParameters, modifiers, keyword))
	}

	// const Name = Data.taggedEnum<Name>(), or Data.taggedEnum<NameDefinition>()
	callee := p.mProperty(p.mIdent("Data", name.Loc), "taggedEnum", name.Loc)
	constructedName := p.mIdent(constructed, name.Loc)
	if typeParameters != nil && len(typeParameters.Nodes) != 0 {
		constructedName = p.mTemp(constructed, name.Loc)
	}
	typeArgument := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(constructedName, nil), name.Loc)
	call := p.vibelangSynthesized(p.factory.NewCallExpression(callee, nil, p.newNodeList(name.Loc, []*ast.Node{typeArgument}), p.newNodeList(name.Loc, nil), ast.NodeFlagsNone), name.Loc)
	var constructorsType *ast.Node
	if constructed == name.Text() {
		constructorsType = p.dataType(keyword, []*ast.Node{p.dataReference(name.Text(), name.Loc)}, "Data", "TaggedEnum", "Constructor")
	} else {
		constructorsType = p.dataGenericConstructors(constructed, len(typeParameters.Nodes), name.Loc, keyword)
	}
	declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(p.mIdent(name.Text(), name.Loc), nil /*exclamationToken*/, constructorsType, call), name.Loc)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(name.Loc, []*ast.Node{declaration}), ast.NodeFlagsConst), name.Loc)
	statement := p.vibelangSpanning(p.factory.NewVariableStatement(p.dataModifiers(modifiers, keyword), list), p.vibelangCompanionLoc(pos, keyword))
	p.reparseList = append(p.reparseList, statement)
	return alias
}

// parseDataVariant parses one variant: its name, then its fields, a type
// literal, when it has any, then its separator: ;, a comma (EK1013), or a
// line break or } as automatic semicolon insertion allows. It returns nil,
// having moved past the token, when no variant starts there.
func (p *Parser) parseDataVariant(form *VibeSyntax) *ast.Node {
	pos := p.nodePos()
	jsdoc := p.jsdocScannerInfo()
	if !tokenIsIdentifierOrKeyword(p.token) {
		p.parseErrorAtCurrentToken(diagnostics.Identifier_expected)
		p.nextToken()
		return nil
	}
	name := p.parseIdentifierName()
	variant := VibeSyntaxVariant{Name: p.sourceRange(name)}
	var fields *ast.Node
	if p.token == ast.KindOpenBraceToken {
		fields = p.parseTypeLiteral()
		variant.Open, variant.Close = p.blockBraces(fields)
	} else {
		fields = p.vibelangSynthesized(p.factory.NewTypeLiteralNode(p.newNodeList(name.Loc, nil)), name.Loc)
	}
	form.Variants = append(form.Variants, variant)
	if !p.parseOptional(ast.KindCommaToken) {
		p.parseSemicolon()
	}
	signature := p.factory.NewPropertySignatureDeclaration(nil /*modifiers*/, name, nil /*postfixToken*/, fields, nil /*initializer*/)
	p.finishNode(signature, pos)
	p.withJSDoc(signature, jsdoc)
	return signature
}

// dataDefinition writes the interface through which a generic data type
// passes its type parameters to Data.taggedEnum:
//
//	interface NameDefinition extends Data.TaggedEnum.WithGenerics<N> {
//	  readonly taggedEnum: Name<this["A"], this["B"]>
//	}
//
// WithGenerics names at most four parameters, A to D; a fifth is EK2126,
// and the interface passes unknown for it.
func (p *Parser) dataDefinition(name *ast.Node, typeParameters *ast.NodeList, modifiers *ast.ModifierList, keyword core.TextRange) *ast.Node {
	count := len(typeParameters.Nodes)
	arguments := make([]*ast.Node, count)
	for i := range typeParameters.Nodes {
		if i >= len(dataGenericNames) {
			arguments[i] = p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUnknownKeyword), keyword)
			continue
		}
		this := p.vibelangSynthesized(p.factory.NewThisTypeNode(), keyword)
		index := p.vibelangSynthesized(p.factory.NewLiteralTypeNode(p.mString(dataGenericNames[i], keyword)), keyword)
		arguments[i] = p.vibelangSynthesized(p.factory.NewIndexedAccessTypeNode(this, index), keyword)
	}
	constructed := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mIdent(name.Text(), name.Loc), p.newNodeList(keyword, arguments)), keyword)
	readonly := p.newModifierList(keyword, []*ast.Node{p.vibelangSynthesized(p.factory.NewModifier(ast.KindReadonlyKeyword), keyword)})
	member := p.vibelangSynthesized(p.factory.NewPropertySignatureDeclaration(readonly, p.mIdent("taggedEnum", keyword), nil, constructed, nil), keyword)
	withGenerics := p.mProperty(p.mProperty(p.mIdent("Data", keyword), "TaggedEnum", keyword), "WithGenerics", keyword)
	countType := p.vibelangSynthesized(p.factory.NewLiteralTypeNode(p.vibelangSynthesized(p.factory.NewNumericLiteral(strconv.Itoa(min(count, len(dataGenericNames))), ast.TokenFlagsNone), keyword)), keyword)
	base := p.vibelangSynthesized(p.factory.NewExpressionWithTypeArguments(withGenerics, p.newNodeList(keyword, []*ast.Node{countType})), keyword)
	clause := p.vibelangSynthesized(p.factory.NewHeritageClause(ast.KindExtendsKeyword, p.newNodeList(keyword, []*ast.Node{base})), keyword)
	declaration := p.factory.NewInterfaceDeclaration(p.dataModifiers(modifiers, keyword), p.mTemp(DataDefinitionName(name.Text()), name.Loc), nil /*typeParameters*/, p.newNodeList(keyword, []*ast.Node{clause}), p.newNodeList(keyword, []*ast.Node{member}))
	return p.vibelangSynthesized(declaration, keyword)
}

// dataReference writes a reference to the type name, synthesized at anchor.
func (p *Parser) dataReference(name string, anchor core.TextRange) *ast.Node {
	return p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mIdent(name, anchor), nil), anchor)
}

// dataType writes a reference to the type that names, such as Data,
// TaggedEnum and Constructor, qualify, with arguments, synthesized at anchor.
func (p *Parser) dataType(anchor core.TextRange, arguments []*ast.Node, names ...string) *ast.Node {
	entity := p.mIdent(names[0], anchor)
	for _, name := range names[1:] {
		entity = p.vibelangSynthesized(p.factory.NewQualifiedName(entity, p.mIdent(name, anchor)), anchor)
	}
	var list *ast.NodeList
	if arguments != nil {
		list = p.newNodeList(anchor, arguments)
	}
	return p.vibelangSynthesized(p.factory.NewTypeReferenceNode(entity, list), anchor)
}

// dataGenericConstructors writes the type that Data.taggedEnum returns for
// definition, a generic data type's interface with count type parameters:
//
//	{
//	  readonly [Tag in Definition["taggedEnum"]["_tag"]]: <A, B>(
//	    args: Data.TaggedEnum.Args<Data.TaggedEnum.Kind<Definition, A, B>, Tag>
//	  ) => Data.TaggedEnum.Value<Data.TaggedEnum.Kind<Definition, A, B>, Tag>
//	} & Data.TaggedEnum.GenericMatchers<Definition>
//
// It is Effect's own, without the Types.Simplify around it.
func (p *Parser) dataGenericConstructors(definition string, count int, nameAnchor core.TextRange, at core.TextRange) *ast.Node {
	count = min(count, len(dataGenericNames))
	literal := func(text string) *ast.Node {
		return p.vibelangSynthesized(p.factory.NewLiteralTypeNode(p.mString(text, at)), at)
	}
	indexed := func(object *ast.Node, key string) *ast.Node {
		return p.vibelangSynthesized(p.factory.NewIndexedAccessTypeNode(object, literal(key)), at)
	}
	tags := indexed(indexed(p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mTemp(definition, nameAnchor), nil), nameAnchor), "taggedEnum"), "_tag")
	tag := p.vibelangSynthesized(p.factory.NewTypeParameterDeclaration(nil, p.mIdent("Tag", at), tags, nil, nil), at)
	kind := func() *ast.Node {
		arguments := []*ast.Node{p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mTemp(definition, nameAnchor), nil), nameAnchor)}
		for _, letter := range dataGenericNames[:count] {
			arguments = append(arguments, p.dataReference(letter, at))
		}
		return p.dataType(at, arguments, "Data", "TaggedEnum", "Kind")
	}
	parameters := make([]*ast.Node, count)
	for i, letter := range dataGenericNames[:count] {
		parameters[i] = p.vibelangSynthesized(p.factory.NewTypeParameterDeclaration(nil, p.mIdent(letter, at), nil, nil, nil), at)
	}
	args := p.dataType(at, []*ast.Node{kind(), p.dataReference("Tag", at)}, "Data", "TaggedEnum", "Args")
	parameter := p.vibelangSynthesized(p.factory.NewParameterDeclaration(nil, nil, p.mIdent("args", at), nil, args, nil), at)
	value := p.dataType(at, []*ast.Node{kind(), p.dataReference("Tag", at)}, "Data", "TaggedEnum", "Value")
	constructor := p.vibelangSynthesized(p.factory.NewFunctionTypeNode(p.newNodeList(at, parameters), p.newNodeList(at, []*ast.Node{parameter}), value), at)
	readonly := p.vibelangSynthesized(p.factory.NewToken(ast.KindReadonlyKeyword), at)
	mapped := p.vibelangSynthesized(p.factory.NewMappedTypeNode(readonly, tag, nil, nil, constructor, p.newNodeList(at, nil)), at)
	matchers := p.dataType(at, []*ast.Node{p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.mTemp(definition, nameAnchor), nil), nameAnchor)}, "Data", "TaggedEnum", "GenericMatchers")
	return p.vibelangSynthesized(p.factory.NewIntersectionTypeNode(p.newNodeList(at, []*ast.Node{mapped, matchers})), at)
}

// dataGenericNames are the type parameters Data.TaggedEnum.WithGenerics declares.
var dataGenericNames = []string{"A", "B", "C", "D"}

// dataModifiers copies modifiers, the data declaration's, for a declaration
// the parser writes beside it, synthesized at keyword.
func (p *Parser) dataModifiers(modifiers *ast.ModifierList, keyword core.TextRange) *ast.ModifierList {
	if modifiers == nil {
		return nil
	}
	copies := make([]*ast.Node, 0, len(modifiers.Nodes))
	for _, modifier := range modifiers.Nodes {
		copies = append(copies, p.vibelangSynthesized(p.factory.NewModifier(modifier.Kind), keyword))
	}
	return p.newModifierList(keyword, copies)
}

// DataDefinitionName is the name of the interface that a generic data type
// Name declares for Data.taggedEnum (D307): NameDefinition.
func DataDefinitionName(name string) string {
	return name + "Definition"
}

// IsDataDeclaration reports whether node is the type alias that a data
// declaration writes (D307).
func IsDataDeclaration(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindTypeAliasDeclaration && node.Flags&ast.NodeFlagsVibeLang != 0
}

// DataVariants returns the variants of alias, a data declaration's type
// alias: each a property signature whose name is the variant's and whose type
// is a type literal of its fields.
func DataVariants(alias *ast.Node) []*ast.Node {
	if !IsDataDeclaration(alias) {
		return nil
	}
	reference := alias.Type()
	if reference == nil || reference.Kind != ast.KindTypeReference {
		return nil
	}
	arguments := reference.TypeArguments()
	if len(arguments) != 1 || arguments[0].Kind != ast.KindTypeLiteral {
		return nil
	}
	return arguments[0].Members()
}

// IsDataConstructors reports whether node is the statement a data
// declaration writes beside its type alias: const Name = Data.taggedEnum<…>().
func IsDataConstructors(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindVariableStatement {
		return false
	}
	declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return false
	}
	call := declarations[0].Initializer()
	if call == nil || call.Kind != ast.KindCallExpression || call.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsPropertyAccessExpression(call.Expression()) {
		return false
	}
	callee := call.Expression()
	data := callee.Expression()
	return ast.IsIdentifier(data) && data.Flags&ast.NodeFlagsReparsed != 0 && data.Text() == "Data" && callee.Name().Text() == "taggedEnum"
}
