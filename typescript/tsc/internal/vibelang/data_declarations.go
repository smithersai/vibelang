package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// The declaration file of a data declaration (D307, foldkit-16). Chapter 1:
// "A ... data declaration is declared as TypeScript's declaration emit of its
// Effect TypeScript counterpart", which writes the type first:
//
//	export type Delivery = Data.TaggedEnum<{ Waiting: {}; Sent: { tracking: string } }>;
//	export declare const Delivery: Data.TaggedEnum.Constructor<{ … } | { … }>;
//
// The parser puts the constant, and a generic one's WithGenerics interface,
// before the type alias, which spans the whole declaration, so this moves
// each type alias before the declarations its data declaration wrote ahead
// of it: type, interface, constant, the counterpart's order.

func init() { compiler.RegisterDeclarationTransformerHook(dataDeclarations) }

func dataDeclarations(resolver printer.EmitResolver, file *ast.SourceFile) func(*ast.SourceFile) *ast.SourceFile {
	if !isVibeLangFile(file) {
		return nil
	}
	ec := resolver.EmitContext()
	return func(declarations *ast.SourceFile) *ast.SourceFile {
		statements, changed := dataTypesFirst(ec, declarations.Statements.Nodes)
		if !changed {
			return declarations
		}
		list := ec.Factory.NewNodeList(statements)
		list.Loc = declarations.Statements.Loc
		return ec.Factory.UpdateSourceFile(declarations, list, declarations.EndOfFileToken).AsSourceFile()
	}
}

// dataTypesFirst returns statements with each data declaration's type alias
// moved before the constant and interface that come right before it, in
// namespace bodies too, and whether any moved.
func dataTypesFirst(ec *printer.EmitContext, statements []*ast.Node) ([]*ast.Node, bool) {
	f := ec.Factory
	changed := false
	result := make([]*ast.Node, 0, len(statements))
	held := 0 // the data constants and interfaces at the end of result
	for _, statement := range statements {
		if ast.IsModuleDeclaration(statement) {
			if body := statement.Body(); body != nil && ast.IsModuleBlock(body) {
				if inner, ok := dataTypesFirst(ec, body.Statements()); ok {
					list := f.NewNodeList(inner)
					list.Loc = body.StatementList().Loc
					declaration := statement.AsModuleDeclaration()
					statement = f.UpdateModuleDeclaration(declaration, statement.Modifiers(), declaration.Keyword, statement.Name(), declaration.Attributes, f.UpdateModuleBlock(body.AsModuleBlock(), list))
					changed = true
				}
			}
		}
		original := ec.MostOriginal(statement)
		switch {
		case parser.IsDataConstructors(original) || isDataDefinitionInterface(original):
			result = append(result, statement)
			held++
			continue
		case parser.IsDataDeclaration(original) && held > 0:
			at := len(result) - held
			result = append(result[:at], append([]*ast.Node{statement}, result[at:]...)...)
			changed = true
		default:
			result = append(result, statement)
		}
		held = 0
	}
	return result, changed
}

// isDataDefinitionInterface reports whether node is the interface a generic
// data declaration writes, interface NameDefinition extends
// Data.TaggedEnum.WithGenerics<N>.
func isDataDefinitionInterface(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindInterfaceDeclaration || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	clauses := node.AsInterfaceDeclaration().HeritageClauses
	if clauses == nil || len(clauses.Nodes) != 1 {
		return false
	}
	types := clauses.Nodes[0].AsHeritageClause().Types.Nodes
	return len(types) == 1 && types[0].Expression().Kind == ast.KindPropertyAccessExpression && types[0].Expression().Name().Text() == "WithGenerics"
}

// dataConstructorTypes writes the type a data declaration's constant infers
// through Data, as its counterpart writes Data.taggedEnum<Name>(), where the
// node builder reached Data only by an import type because a name in the
// file shadows the prelude's (`export const Data = …`):
// import("effect/Data").TaggedEnum.Constructor<…> becomes
// Data.TaggedEnum.Constructor<…>, which transformDeclarations imports, under
// a fresh alias such as Data_1 when the file declares Data itself.
type dataConstructorTypes struct {
	transformers.Transformer
	record func(identifier *ast.Node) // records a prelude name the declaration file writes
	inData bool
}

func (tx *dataConstructorTypes) visit(node *ast.Node) *ast.Node {
	if ast.IsVariableStatement(node) {
		if !parser.IsDataConstructors(tx.EmitContext().MostOriginal(node)) {
			return node
		}
		tx.inData = true
		defer func() { tx.inData = false }()
	}
	node = tx.Visitor().VisitEachChild(node)
	if !tx.inData || node.Kind != ast.KindImportType {
		return node
	}
	t := node.AsImportTypeNode()
	if t.IsTypeOf || t.Argument == nil || !ast.IsLiteralTypeNode(t.Argument) || t.Qualifier == nil {
		return node
	}
	if literal := t.Argument.AsLiteralTypeNode().Literal; !ast.IsStringLiteral(literal) || literal.Text() != "effect/Data" {
		return node
	}
	f := tx.Factory()
	data := f.NewIdentifier("Data")
	tx.record(data)
	var under func(*ast.Node) *ast.Node // the qualifier, with Data before its first name
	under = func(name *ast.Node) *ast.Node {
		if ast.IsIdentifier(name) {
			return f.NewQualifiedName(data, f.NewIdentifier(name.Text()))
		}
		q := name.AsQualifiedName()
		return f.NewQualifiedName(under(q.Left), f.NewIdentifier(q.Right.Text()))
	}
	return f.NewTypeReferenceNode(under(t.Qualifier), t.TypeArguments)
}
