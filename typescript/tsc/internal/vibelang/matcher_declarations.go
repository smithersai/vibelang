package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// VIP-27's public declaration boundary retains the generated protocol member
// and imports the runtime's SymbolConstructor augmentation in each output.
type matcherDeclarations struct {
	transformers.Transformer
	wrote       bool
	symbolBound bool
	keyImport   *ast.Node
}

func (tx *matcherDeclarations) visit(node *ast.Node) *ast.Node {
	original := tx.EmitContext().MostOriginal(node)
	node = tx.Visitor().VisitEachChild(node)
	if !ast.IsClassDeclaration(node) || !errorDeclarationBase(original) {
		return node
	}
	f := tx.Factory()
	keyExpression := f.NewPropertyAccessExpression(f.NewIdentifier("Symbol"), nil, f.NewIdentifier("customMatcher"), ast.NodeFlagsNone)
	if tx.symbolBound {
		// Namespace bindings can capture Symbol or globalThis. Use the
		// runtime's canonical key through a fresh import in either case.
		if tx.keyImport == nil {
			tx.keyImport = f.NewUniqueName("$customMatcher")
		}
		keyExpression = tx.keyImport
	}
	key := f.NewComputedPropertyName(keyExpression)
	unknown := func() *ast.Node { return f.NewKeywordTypeNode(ast.KindUnknownKeyword) }
	hint := f.NewTypeLiteralNode(f.NewNodeList([]*ast.Node{
		f.NewPropertySignatureDeclaration(f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindReadonlyKeyword)}), f.NewIdentifier("matchType"), nil,
			f.NewUnionTypeNode(f.NewNodeList([]*ast.Node{f.NewLiteralTypeNode(f.NewStringLiteral("boolean", ast.TokenFlagsNone)), f.NewLiteralTypeNode(f.NewStringLiteral("extractor", ast.TokenFlagsNone))})), nil),
	}))
	parameters := f.NewNodeList([]*ast.Node{
		f.NewParameterDeclaration(nil, nil, f.NewIdentifier("subject"), nil, unknown(), nil),
		f.NewParameterDeclaration(nil, nil, f.NewIdentifier("hint"), f.NewToken(ast.KindQuestionToken), hint, nil),
	})
	result := f.NewUnionTypeNode(f.NewNodeList([]*ast.Node{
		f.NewKeywordTypeNode(ast.KindBooleanKeyword), f.NewTypeOperatorNode(ast.KindReadonlyKeyword, f.NewTupleTypeNode(f.NewNodeList([]*ast.Node{unknown()}))),
	}))
	method := f.NewMethodDeclaration(f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindStaticKeyword)}), nil, key, nil, nil, parameters, result, nil, nil)
	members := append([]*ast.Node{method}, node.Members()...)
	tx.wrote = true
	return f.UpdateClassDeclaration(node.AsClassDeclaration(), node.Modifiers(), node.Name(), node.TypeParameterList(), node.AsClassDeclaration().HeritageClauses, f.NewNodeList(members))
}

func (tx *matcherDeclarations) runtimeReference(file *ast.SourceFile) *ast.SourceFile {
	if !tx.wrote {
		return file
	}
	if tx.keyImport != nil {
		f := tx.Factory()
		imported := f.NewImportSpecifier(false, f.NewIdentifier("customMatcher"), tx.keyImport)
		declaration := f.NewImportDeclaration(nil, f.NewImportClause(ast.KindUnknown, nil,
			f.NewNamedImports(f.NewNodeList([]*ast.Node{imported}))), f.NewStringLiteral("vibelang-runtime", ast.TokenFlagsNone), nil)
		ast.SetParentInChildren(declaration)
		statements := f.NewNodeList(append([]*ast.Node{declaration}, file.Statements.Nodes...))
		statements.Loc = file.Statements.Loc
		file = f.UpdateSourceFile(file, statements, file.EndOfFileToken).AsSourceFile()
	}
	refs := []*ast.FileReference{{FileName: "vibelang-runtime"}}
	for _, ref := range file.TypeReferenceDirectives {
		if ref.FileName != "vibelang-runtime" {
			refs = append(refs, ref)
		}
	}
	file.TypeReferenceDirectives = refs
	return file
}
