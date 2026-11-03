package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK4402's quick fix for an import of a platform module whose bindings no code
// reads as a value. A class is a value and a type, so TypeScript accepts
//
//	import { AsyncLocalStorage } from "node:async_hooks"
//	export type Context = AsyncLocalStorage<unknown>
//
// and keeps the runtime load. import type erases it, and chapter 5 allows
// that. No value changes, and the declaration prints the same type. Any value
// read, a re-export included, leaves the import and its EK4402 as they are.
// vibelang --fix applies it.

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: platformTypeOnlyImportFix})
}

// platformImportOfBinding returns the import declaration that node, a binding
// name EK4402 stands at, belongs to, when it imports a platform module; or nil.
func platformImportOfBinding(node *ast.Node) *ast.Node {
	for n := node; n != nil; n = n.Parent {
		if ast.IsImportDeclaration(n) {
			specifier := n.ModuleSpecifier()
			if specifier == nil || !ast.IsStringLiteral(specifier) {
				return nil
			}
			if _, platform := platformModuleOf(specifier.Text()); !platform {
				return nil
			}
			return n
		}
		if ast.IsSourceFile(n) {
			return nil
		}
	}
	return nil
}

// importBindingNames returns the names statement binds.
func importBindingNames(statement *ast.Node) []*ast.Node {
	clause := statement.ImportClause()
	if clause == nil {
		return nil
	}
	var names []*ast.Node
	if name := clause.Name(); name != nil {
		names = append(names, name)
	}
	switch bindings := clause.AsImportClause().NamedBindings; {
	case bindings == nil:
	case ast.IsNamespaceImport(bindings):
		names = append(names, bindings.Name())
	default:
		for _, element := range bindings.Elements() {
			names = append(names, element.Name())
		}
	}
	return names
}

// readsImportAsValue reports whether file's code outside statement reads one
// of statement's bindings as a value: a read, a shorthand property, or a
// re-export, which keeps the value in the module's exports.
func readsImportAsValue(c *checker.Checker, file *ast.SourceFile, statement *ast.Node) bool {
	symbols := map[*ast.Symbol]bool{}
	for _, name := range importBindingNames(statement) {
		symbols[c.GetSymbolAtLocation(name)] = true
	}
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found || node == statement || node.Kind == ast.KindTypeQuery {
			return found
		}
		if ast.IsIdentifier(node) && node.Parent != nil {
			switch {
			case ast.IsShorthandPropertyAssignment(node.Parent):
				found = symbols[c.GetShorthandAssignmentValueSymbol(node.Parent)]
			case ast.IsExportSpecifier(node.Parent):
				found = symbols[c.GetExportSpecifierLocalTargetSymbol(node.Parent)]
			case isValueUse(node):
				found = symbols[c.GetSymbolAtLocation(node)]
			}
		}
		if found {
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// typeOnlyImportEdits returns the edits that make statement import type, or
// nil when TypeScript has no such form: import type takes a default binding
// or named ones, not both, and attributes or a phase change what it loads.
func typeOnlyImportEdits(file *ast.SourceFile, statement *ast.Node) []sourceEdit {
	clause := statement.ImportClause().AsImportClause()
	if statement.AsImportDeclaration().Attributes != nil || clause.PhaseModifier != ast.KindUnknown || clause.IsTypeOnly() {
		return nil
	}
	if clause.Name() != nil && clause.NamedBindings != nil {
		return nil
	}
	start := nodeStart(file, statement) + len("import")
	edits := []sourceEdit{{start, start, " type"}}
	if clause.NamedBindings == nil || !ast.IsNamedImports(clause.NamedBindings) {
		return edits
	}
	text := file.Text()
	for _, element := range clause.NamedBindings.Elements() {
		if !element.AsImportSpecifier().IsTypeOnly {
			continue
		}
		at := nodeStart(file, element)
		end := at + len("type")
		if end > len(text) || text[at:end] != "type" {
			return nil
		}
		for end < len(text) && (text[end] == ' ' || text[end] == 9) {
			end++
		}
		edits = append(edits, sourceEdit{at, end, ""})
	}
	return edits
}

func platformTypeOnlyImportFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	statement := platformImportOfBinding(reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
		return ast.IsIdentifier(node) || ast.IsImportSpecifier(node) || ast.IsNamespaceImport(node)
	}))
	if statement == nil || statement.ImportClause() == nil || len(importBindingNames(statement)) == 0 {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	reads := readsImportAsValue(c, fix.SourceFile, statement)
	done()
	if reads {
		return nil, nil
	}
	edits := typeOnlyImportEdits(fix.SourceFile, statement)
	if edits == nil {
		return nil, nil
	}
	var changes = replaceRange(fix, edits[0].start, edits[0].end, edits[0].text)
	for _, edit := range edits[1:] {
		changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
	}
	return []*ls.CodeAction{{Description: "Write import type", Changes: changes}}, nil
}
