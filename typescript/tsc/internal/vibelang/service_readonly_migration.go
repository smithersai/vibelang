package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const serviceReadonlyLabel = "legacy service readonly fields"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, serviceReadonlyMigrationFixes)
}

// Old service bodies made instance fields readonly, and their nested types
// used the old native type-member default. Static fields and methods did not
// gain a readonly modifier. Only the explicitly requested source upgrade
// materializes those defaults; checking and ordinary fixes use current types.
func serviceReadonlyMigrationFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	raw, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/service-readonly-upgrade.vibe", PathKey: "/service-readonly-upgrade.vibe"}, file.Text())
	services := map[int]parser.VibeSyntax{}
	mutable := map[int]bool{}
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxDeclaration && form.Name == "service" {
			services[form.Range.Pos()] = form
		}
		if form.Kind == parser.VibeSyntaxMutable {
			mutable[form.Word.Pos()] = true
		}
	}
	seen := map[int]bool{}
	add := func(node *ast.Node) {
		if mutable[nodeStart(raw, node)] {
			return
		}
		for _, mod := range node.ModifierNodes() {
			if mod.Kind == ast.KindReadonlyKeyword && mod.Flags&ast.NodeFlagsReparsed == 0 {
				return
			}
		}
		anchor := node
		if node.Name() != nil {
			anchor = node.Name()
		}
		pos := nodeStart(raw, anchor)
		key := fmt.Sprintf("legacy-service-readonly:%d", pos)
		if !seen[pos] && !refused[key] {
			seen[pos] = true
			result.fixes = append(result.fixes, fileFix{label: serviceReadonlyLabel, key: key, edits: []sourceEdit{{pos, pos, "readonly "}}})
		}
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(node) {
			return false
		}
		if ast.IsClassDeclaration(node) {
			if form, ok := services[nodeStart(raw, node)]; ok {
				if form.Right.Len() == 0 {
					for _, member := range node.AsClassDeclaration().Members.Nodes {
						if !ast.IsPropertyDeclaration(member) || member.Name() == nil {
							continue
						}
						static := false
						for _, mod := range member.ModifierNodes() {
							if mod.Kind == ast.KindStaticKeyword {
								static = true
							}
						}
						if !static {
							add(member)
						}
					}
				}
				var types func(*ast.Node) bool
				types = func(child *ast.Node) bool {
					if parser.IsVibeLangModuleDeclaration(child) {
						return false
					}
					start := nodeStart(raw, child)
					for _, nested := range forms {
						if nested.Kind == parser.VibeSyntaxDeclaration && nested.Range.Pos() > form.Range.Pos() &&
							nested.Range.End() <= form.Range.End() && nested.Range.Pos() <= start && start < nested.Range.End() {
							return false
						}
					}
					if ast.IsPropertySignatureDeclaration(child) && child.Name() != nil || ast.IsIndexSignatureDeclaration(child) {
						add(child)
					}
					return child.ForEachChild(types)
				}
				node.ForEachChild(types)
			}
		}
		return node.ForEachChild(visit)
	}
	raw.AsNode().ForEachChild(visit)
	return result
}
