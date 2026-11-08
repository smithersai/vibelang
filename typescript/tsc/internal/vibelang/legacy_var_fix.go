package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// blockScopedVarAction is chapter 1's quick fix for a var statement: let, or
// const when no binding is ever assigned. It is offered only where block
// scoping cannot change what runs, so the rewrite keeps the program's
// behavior:
//   - the statement sits directly in a block, module block or the file, with
//     no loop between it and its function, so there is one binding per scope
//     entry and no closure sees a per-iteration copy;
//   - it has no export, and each name has this one declaration, so no
//     redeclaration, parameter or importer shares the binding;
//   - every reference lies after its own declarator, inside the statement's
//     block and outside any hoisted function declaration, so none can run
//     before initialization (a let would throw where var reads undefined).
func blockScopedVarAction(ctx context.Context, fix *ls.CodeFixContext) *ls.CodeAction {
	file := fix.SourceFile
	text := file.Text()
	start := scanner.SkipTrivia(text, fix.Span.Pos())
	if start+len("var") > len(text) || text[start:start+len("var")] != "var" {
		return nil
	}
	var list *ast.Node
	var find func(*ast.Node) bool
	find = func(n *ast.Node) bool {
		if n.Pos() > start || n.End() <= start {
			return false
		}
		if n.Kind == ast.KindVariableDeclarationList && scanner.SkipTrivia(text, n.Pos()) == start {
			list = n
			return true
		}
		return n.ForEachChild(find)
	}
	file.AsNode().ForEachChild(find)
	if list == nil || list.Flags&ast.NodeFlagsBlockScoped != 0 {
		return nil
	}
	statement := list.Parent
	if statement == nil || statement.Kind != ast.KindVariableStatement || ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
		return nil
	}
	container := statement.Parent
	if container == nil || container.Kind != ast.KindBlock && container.Kind != ast.KindModuleBlock && container.Kind != ast.KindSourceFile {
		return nil
	}
	for n := container; n != nil && !ast.IsFunctionLike(n) && n.Kind != ast.KindSourceFile; n = n.Parent {
		if ast.IsIterationStatement(n, false) {
			return nil
		}
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	ambient := statement.Flags&ast.NodeFlagsAmbient != 0
	assigned := false
	for _, declarator := range list.AsVariableDeclarationList().Declarations.Nodes {
		if declarator.Initializer() == nil && !ambient {
			assigned = true // const needs an initializer; let keeps undefined
		}
		for _, name := range varBindingNames(declarator.Name()) {
			written, ok := varReferencesSafe(c, file, container, declarator, name)
			if !ok {
				return nil
			}
			assigned = assigned || written
		}
	}
	keyword := "const"
	if assigned {
		keyword = "let"
	}
	return &ls.CodeAction{Description: "Write " + keyword + " instead of var", Changes: replaceRange(fix, start, start+len("var"), keyword)}
}

// varBindingNames returns the identifiers a binding name declares.
func varBindingNames(name *ast.Node) []*ast.Node {
	if name == nil {
		return nil
	}
	if ast.IsIdentifier(name) {
		return []*ast.Node{name}
	}
	var names []*ast.Node
	if ast.IsBindingPattern(name) {
		for _, element := range name.AsBindingPattern().Elements.Nodes {
			names = append(names, varBindingNames(element.Name())...)
		}
	}
	return names
}

// varReferencesSafe reports whether every reference to name's binding meets
// blockScopedVarAction's conditions, and whether any reference writes it.
func varReferencesSafe(c *checker.Checker, file *ast.SourceFile, container, declarator, name *ast.Node) (written, ok bool) {
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil || len(symbol.Declarations()) != 1 {
		return false, false
	}
	ok = true
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if !ok {
			return true
		}
		if n.Kind == ast.KindExportSpecifier {
			local := n.AsExportSpecifier().PropertyName
			if local == nil {
				local = n.Name()
			}
			if local != nil && local.Text() == name.Text() {
				ok = false
				return true
			}
		}
		if ast.IsIdentifier(n) && n != name && n.Text() == name.Text() {
			s := c.GetSymbolAtLocation(n)
			if n.Parent != nil && n.Parent.Kind == ast.KindShorthandPropertyAssignment {
				s = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if s == symbol {
				if n.Pos() < declarator.End() || n.Pos() < container.Pos() || n.End() > container.End() {
					ok = false
					return true
				}
				for a := n.Parent; a != nil && a != container; a = a.Parent {
					if a.Kind == ast.KindFunctionDeclaration {
						ok = false
						return true
					}
				}
				written = written || ast.IsWriteAccess(n)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return written, ok
}
