package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Schema data declarations (VIP-74): serializable tagged unions lowered
// directly to Effect 4's Schema.TaggedUnion and its companion type alias.
//
//	schema data Shape {
//	  Empty
//	  Circle { radius: number }
//	}
//
// parses as:
//
//	type Shape = typeof Shape.Type
//	const Shape = Schema.TaggedUnion({
//	  Empty: {},
//	  Circle: { radius: Schema.mutableKey(Schema.Number) },
//	})

// VibeSyntaxSchemaData is the Name of the VibeSyntaxDeclaration recorded for
// a schema data declaration.
const VibeSyntaxSchemaData = "schema data"

// VibeLangSchemaDataMissingBodyMessage describes a schema data declaration
// missing its variant block.
const VibeLangSchemaDataMissingBodyMessage = "A schema data declaration needs a variant body. Write schema data Name { variants }, even when the body is empty."

// IsSchemaTaggedUnion reports whether node is the Schema.TaggedUnion call that
// the parser writes for a schema data declaration (VIP-74).
func IsSchemaTaggedUnion(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindCallExpression || node.Flags&ast.NodeFlagsVibeLang == 0 {
		return false
	}
	callee := node.Expression()
	return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "TaggedUnion"
}

// isStartOfVibeLangSchemaData reports whether the current token, schema,
// starts a schema data declaration: schema data Name, with data and Name on
// the same line. A schema named data is still schema data { ... } or
// schema data = Type.
func (p *Parser) isStartOfVibeLangSchemaData() bool {
	return p.lookAhead(func(p *Parser) bool {
		p.nextToken() // schema
		if p.token != ast.KindIdentifier || p.scanner.TokenValue() != "data" || p.hasPrecedingLineBreak() {
			return false
		}
		p.nextToken()
		return !p.hasPrecedingLineBreak() && p.isIdentifier()
	})
}

// parseSchemaDataDeclaration parses schema data Name { Variant; Variant { fields } }.
func (p *Parser) parseSchemaDataDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	schemaWord := p.tokenRange()
	p.nextToken() // schema
	if p.scanner.HasUnicodeEscape() || p.scanner.HasExtendedUnicodeEscape() {
		p.parseErrorAtCurrentToken(diagnostics.Keywords_cannot_contain_escape_characters)
	}
	p.nextToken() // data
	name := p.parseBindingIdentifier()
	p.parseVibeLangSchemaTypeParameters()
	form := VibeSyntax{
		Kind:    VibeSyntaxDeclaration,
		Name:    VibeSyntaxSchemaData,
		Head:    core.NewTextRange(schemaWord.Pos(), name.End()),
		Ambient: p.isVibeLangAmbientService(modifiers),
	}
	var object *ast.Node
	body := name.Loc
	if p.token == ast.KindOpenBraceToken {
		object, body = p.parseSchemaDataVariants(&form)
		p.parseOptional(ast.KindSemicolonToken)
	} else {
		if !form.Ambient {
			p.reportVibeLangMissingBody(name, VibeLangDataMissingBodyCode, VibeLangSchemaDataMissingBodyMessage)
		}
		object = p.vibelangSynthesized(p.factory.NewObjectLiteralExpression(p.newNodeList(name.Loc, nil), false), name.Loc)
	}
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)
	brace := scanner.SkipTrivia(p.sourceText, body.Pos())
	union := p.vibelangSchemaCall("TaggedUnion", core.NewTextRange(body.Pos(), min(brace+1, body.End())), object)
	union.Flags |= ast.NodeFlagsVibeLang
	declRange := core.NewTextRange(name.Pos(), union.End())
	decl := p.vibelangSpanning(p.factory.NewVariableDeclaration(name, nil, nil, union), declRange)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(declRange, []*ast.Node{decl}), ast.NodeFlagsConst), declRange)
	statement := p.factory.NewVariableStatement(modifiers, list)
	p.finishNode(statement, pos)
	p.withJSDoc(statement, jsdoc)
	p.reparseList = append(p.reparseList, p.vibelangSchemaType(schemaWord, name, modifiers))
	return statement
}

// parseSchemaDataVariants parses the braced variant list of a schema data
// declaration into the object literal argument of Schema.TaggedUnion({...}).
func (p *Parser) parseSchemaDataVariants(form *VibeSyntax) (*ast.Node, core.TextRange) {
	bodyStart := p.nodePos()
	form.Open = p.tokenRange()
	p.nextToken() // {
	var variants []*ast.Node
	for p.token != ast.KindCloseBraceToken && p.token != ast.KindEndOfFile {
		if variant := p.parseSchemaDataVariant(form); variant != nil {
			variants = append(variants, variant)
		}
	}
	if p.token == ast.KindCloseBraceToken {
		form.Close = p.tokenRange()
	}
	p.parseExpected(ast.KindCloseBraceToken)
	body := core.NewTextRange(bodyStart, p.nodePos())
	brace := scanner.SkipTrivia(p.sourceText, body.Pos())
	inside := core.NewTextRange(min(brace+1, body.End()), max(body.End()-1, min(brace+1, body.End())))
	return p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(inside, variants), true), body), body
}

// parseSchemaDataVariant parses one schema data variant into a property
// assignment `Variant: { field: Schema... }` or `Variant: {}`.
func (p *Parser) parseSchemaDataVariant(form *VibeSyntax) *ast.Node {
	pos := p.nodePos()
	jsdoc := p.jsdocScannerInfo()
	if !tokenIsIdentifierOrKeyword(p.token) {
		p.skipInvalidSchemaDataVariant()
		return nil
	}
	name := p.parseIdentifierName()
	variant := VibeSyntaxVariant{Name: p.sourceRange(name)}
	fields := p.parseSchemaDataVariantPayload(name, &variant)
	form.Variants = append(form.Variants, variant)
	p.parseSchemaDataVariantSeparator()
	key := p.vibelangSchemaPropertyName(name)
	prop := p.factory.NewPropertyAssignment(nil, key, nil, nil, fields)
	p.finishNode(prop, pos)
	p.withJSDoc(prop, jsdoc)
	return prop
}

// skipInvalidSchemaDataVariant diagnoses a non-identifier variant token and
// skips any attached payload so later variants still parse cleanly.
func (p *Parser) skipInvalidSchemaDataVariant() {
	wasSeparator := p.token == ast.KindSemicolonToken || p.token == ast.KindCommaToken
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.scanner.TokenRange(), "EK", diagnostics.CategoryError, 1606, "A data variant needs an identifier name, such as `Ready`."))
	p.hasParseError = true
	p.nextToken()
	switch p.token {
	case ast.KindOpenBraceToken:
		p.parseVibeLangFields(schemaFieldSeparatorDiagnostic)
	case ast.KindOpenParenToken:
		p.skipDataVariantParameters()
	}
	if !wasSeparator && !p.parseOptional(ast.KindCommaToken) {
		p.parseOptional(ast.KindSemicolonToken)
	}
}

// parseSchemaDataVariantPayload parses a variant's optional `{ fields }` body
// into its Schema.TaggedUnion field object, or diagnoses a parenthesized list.
func (p *Parser) parseSchemaDataVariantPayload(name *ast.Node, variant *VibeSyntaxVariant) *ast.Node {
	switch p.token {
	case ast.KindOpenBraceToken:
		saved := p.vibelangImplicitReadonly
		p.vibelangImplicitReadonly = true
		literal := p.parseVibeLangFields(schemaFieldSeparatorDiagnostic)
		p.vibelangImplicitReadonly = saved
		variant.Open, variant.Close = p.blockBraces(literal)
		savedBody := p.vibelangSchemaBody
		p.vibelangSchemaBody = true
		obj := p.vibelangSchemaVariantFields(literal.AsTypeLiteralNode().Members.Nodes, literal.Loc)
		p.vibelangSchemaBody = savedBody
		return obj
	case ast.KindOpenParenToken:
		list := p.skipDataVariantParameters()
		msg := name.Text() + " lists its payload in parentheses: a variant's payload is a field list in braces, " + name.Text() + " { x: number }."
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, list, "EK", diagnostics.CategoryError, 1606, msg))
		p.hasParseError = true
		return p.vibelangSynthesized(p.factory.NewObjectLiteralExpression(p.newNodeList(list, nil), false), list)
	default:
		return p.vibelangSynthesized(p.factory.NewObjectLiteralExpression(p.newNodeList(name.Loc, nil), false), name.Loc)
	}
}

// parseSchemaDataVariantSeparator consumes `;`, a newline, or `}` after a
// variant, diagnosing missing separators with EK1605.
func (p *Parser) parseSchemaDataVariantSeparator() {
	if !p.parseOptional(ast.KindCommaToken) {
		if p.canParseSemicolon() {
			p.parseSemicolon()
		} else {
			p.diagnostics = append(p.diagnostics, dataMemberSeparatorDiagnostic(p.nodePos()))
			p.hasParseError = true
		}
	}
}

// vibelangSchemaVariantFields builds the field-schema object literal for one
// schema data variant following VIP-15 schema field mapping rules.
func (p *Parser) vibelangSchemaVariantFields(members []*ast.Node, body core.TextRange) *ast.Node {
	properties := p.vibelangSchemaFieldProperties(members)
	brace := scanner.SkipTrivia(p.sourceText, body.Pos())
	inside := core.NewTextRange(min(brace+1, body.End()), max(body.End()-1, min(brace+1, body.End())))
	return p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(inside, properties), true), body)
}
