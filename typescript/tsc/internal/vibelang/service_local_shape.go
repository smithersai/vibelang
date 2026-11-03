package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

const localServiceShapeLabel = "local service shape"

// A body-only service has a public Shape namespace only at module scope.
// A written whole-shape annotation has no implicit namespace (VIP-9 amended).
func serviceShapeNamespaceScope(class *ast.Node) bool {
	return serviceShape(class) == nil && class.Parent != nil && (ast.IsSourceFile(class.Parent) || ast.IsModuleBlock(class.Parent))
}

// serviceOwnShapeName admits VIP-9's type-only self-shape hook in the
// written instance member contract. The resolved class identifies the owner;
// spelling alone cannot capture a shadowing declaration. Initializers, bodies,
// computed names and static members do not form the instance member type.
func serviceOwnShapeName(class *ast.Node, name *ast.Node) bool {
	// An explicit annotation supplies the type inside its own key/default
	// body, without creating a public namespace (VIP-9 amended).
	if serviceShape(class) != nil {
		for _, member := range class.Members() {
			if ast.IsNodeDescendantOf(name, member) {
				return true
			}
		}
		return false
	}
	for _, member := range class.Members() {
		if ast.IsStatic(member) {
			continue
		}
		if ast.IsPropertyDeclaration(member) {
			if ast.IsNodeDescendantOf(name, member.Type()) {
				return true
			}
		} else if ast.IsMethodDeclaration(member) {
			if ast.IsNodeDescendantOf(name, member.Type()) {
				return true
			}
			for _, parameter := range member.Parameters() {
				if ast.IsNodeDescendantOf(name, parameter.Type()) {
					return true
				}
			}
			for _, parameter := range member.TypeParameters() {
				if ast.IsNodeDescendantOf(name, parameter) {
					return true
				}
			}
		}
	}
	return false
}

func localServiceShapeName(c *checker.Checker, name *ast.Node) bool {
	if name == nil || !ast.IsQualifiedName(name) || name.AsQualifiedName().Right.Text() != serviceShapeName {
		return false
	}
	if ast.IsTypeReferenceNode(name.Parent) && name.Parent.AsTypeReferenceNode().TypeArguments != nil {
		return false // the non-generic Shape alias cannot preserve these arguments
	}
	symbol := c.ResolveEntityName(name.AsQualifiedName().Left, ast.SymbolFlagsType)
	if symbol == nil {
		return false
	}
	class := symbol.ValueDeclaration()
	return classKindOf(class) == serviceClass && !serviceShapeNamespaceScope(class) && !serviceOwnShapeName(class, name)
}

func localServiceShapeEdit(file *ast.SourceFile, name *ast.Node) sourceEdit {
	left := nodeText(file, name.AsQualifiedName().Left)
	// A type import works without a Context global and cannot capture a local binding.
	return sourceEdit{nodeStart(file, name), name.End(), "import(\"effect/Context\").Service.Shape<typeof " + left + ">"}
}

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: []int32{2702, 2503},
		GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			name := astnav.GetTokenAtPosition(fix.SourceFile, fix.Span.Pos())
			if name == nil {
				return nil, nil
			}
			if ast.IsIdentifier(name) {
				name = name.Parent
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			if !localServiceShapeName(c, name) {
				return nil, nil
			}
			edit := localServiceShapeEdit(fix.SourceFile, name)
			return []*ls.CodeAction{{Description: "Use Context.Service.Shape for the local service", Changes: replaceRange(fix, edit.start, edit.end, edit.text)}}, nil
		},
	})
}

func localServiceShapeMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	p := proposal{file: file}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsTypeReferenceNode(node) {
			name := node.AsTypeReferenceNode().TypeName
			if localServiceShapeName(c, name) {
				key := localServiceShapeLabel + ":" + nodeText(file, name)
				if !refused[key] {
					p.fixes = append(p.fixes, fileFix{code: 2702, label: localServiceShapeLabel, key: key, edits: []sourceEdit{localServiceShapeEdit(file, name)}})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}
