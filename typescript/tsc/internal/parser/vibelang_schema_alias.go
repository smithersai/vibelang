package parser

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The alias form of a schema declaration (D280).
//
//	schema Code = "root_missing" | "read_failed"
//
// parses as the two declarations it abbreviates:
//
//	const Code = Schema.Literals(["root_missing", "read_failed"])
//	type Code = typeof Code.Type
//
// The type becomes its schema with D133's mapping (vibelangSchemaOf), so any
// type a struct field may have may follow the =: a union of literals or of
// other forms, an array, a tuple, a record, an object type, or the name of
// another schema. Any other type becomes Schema.Unknown flagged
// NodeFlagsVibeLang, which the checker reports as EK2109 (schemas.go). The
// variable declaration is flagged NodeFlagsVibeLang too, which is how the
// checker, the ESTree converter, and the projection tell the alias form from
// a const written out. The type alias goes to p.reparseList, as the struct
// form's does.

// VibeSyntaxSchemaAlias is the Name of the VibeSyntaxDeclaration recorded for
// the alias form: Head runs from schema through the name, and Open and Close
// are empty.
const VibeSyntaxSchemaAlias = "schema alias"

// scanSchemaAliasStart reports whether the current token, schema, starts the
// alias form: schema, a name, and =. It moves the scanner; call it through
// lookAhead.
func (p *Parser) scanSchemaAliasStart() bool {
	p.nextToken() // schema
	if !p.isIdentifier() {
		return false
	}
	p.nextToken()
	return p.token == ast.KindEqualsToken
}

// parseSchemaAliasDeclaration parses schema Name = Type.
func (p *Parser) parseSchemaAliasDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	keyword := p.scanner.TokenRange()
	p.nextToken() // schema
	name := p.parseBindingIdentifier()
	p.parseExpected(ast.KindEqualsToken)
	saved := p.vibelangImplicitReadonly
	p.vibelangImplicitReadonly = true // as in a schema's fields (vibelang.go)
	typeNode := p.parseType()
	p.vibelangImplicitReadonly = saved
	p.parseSemicolon()
	p.recordVibeSyntax(VibeSyntax{
		Kind:  VibeSyntaxDeclaration,
		Name:  VibeSyntaxSchemaAlias,
		Head:  core.NewTextRange(keyword.Pos(), name.End()),
		Range: core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos()),
	})

	// const Code = <the type's schema>
	value := p.vibelangSchemaOf(typeNode)
	span := core.NewTextRange(name.Pos(), typeNode.End())
	declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(name, nil /*exclamationToken*/, nil /*typeNode*/, value), span)
	declaration.Flags |= ast.NodeFlagsVibeLang
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(span, []*ast.Node{declaration}), ast.NodeFlagsConst), span)
	statement := p.factory.NewVariableStatement(modifiers, list)
	p.finishNode(statement, pos)
	p.withJSDoc(statement, jsdoc)

	// type Code = typeof Code.Type
	p.reparseList = append(p.reparseList, p.vibelangSchemaType(pos, keyword, name, modifiers))
	return statement
}

// vibelangSchemaType makes the type that a schema declaration declares beside
// its constant, type Name = typeof Name.Type (D280, D501), exported as the
// constant is, on vibelangCompanionLoc.
func (p *Parser) vibelangSchemaType(pos int, keyword core.TextRange, name *ast.Node, modifiers *ast.ModifierList) *ast.Node {
	var aliasModifiers *ast.ModifierList
	if modifiers != nil {
		var copies []*ast.Node
		for _, modifier := range modifiers.Nodes {
			copies = append(copies, p.vibelangSynthesized(p.factory.NewModifier(modifier.Kind), keyword))
		}
		aliasModifiers = p.newModifierList(keyword, copies)
	}
	typeName := p.vibelangSynthesized(p.factory.NewIdentifier(name.Text()), name.Loc)
	left := p.vibelangSynthesized(p.factory.NewIdentifier(name.Text()), name.Loc)
	right := p.vibelangSynthesized(p.factory.NewIdentifier("Type"), name.Loc)
	query := p.vibelangSynthesized(p.factory.NewTypeQueryNode(p.vibelangSynthesized(p.factory.NewQualifiedName(left, right), name.Loc), nil /*typeArguments*/), name.Loc)
	alias := p.factory.NewTypeAliasDeclaration(aliasModifiers, typeName, nil /*typeParameters*/, query)
	return p.vibelangSynthesized(alias, p.vibelangCompanionLoc(pos, keyword))
}

// vibelangCompanionLoc is the range of the declaration a schema form adds
// before its constant (the alias form's type, the struct form's interface):
// from the line break before the declaration's own JSDoc, or from the keyword
// when it has none, to the keyword's end. The constant's statement starts at
// pos, so it alone owns the comments before that JSDoc, such as the file's
// header: the printers emit a node's leading comments from its position, and
// two nodes at pos would both print the header. The range starts at the line
// break because a scan for leading comments collects a comment only after a
// line break, except at the start of the file. The companion still carries
// the JSDoc, so the type and the constant are documented alike.
func (p *Parser) vibelangCompanionLoc(pos int, keyword core.TextRange) core.TextRange {
	start := keyword.Pos()
	for comment := range scanner.GetLeadingCommentRanges(&p.factory, p.sourceText, pos) {
		text := p.sourceText[comment.Pos():comment.End()]
		if comment.Kind == ast.KindMultiLineCommentTrivia && len(text) > 4 && text[:3] == "/**" {
			start = pos
			if lineBreak := strings.LastIndexByte(p.sourceText[pos:comment.Pos()], '\n'); lineBreak >= 0 {
				start = pos + lineBreak
			}
		}
	}
	return core.NewTextRange(start, keyword.End())
}

// IsSchemaAliasDeclaration reports whether node is the variable declaration
// of a schema alias, schema Name = Type (D280).
func IsSchemaAliasDeclaration(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindVariableDeclaration && node.Flags&ast.NodeFlagsVibeLang != 0
}
