package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const nativeTypeReadonlyLabel = "legacy type readonly keys"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, nativeTypeReadonlyMigrationFixes)
}

// Before 0.0.11, native interface and type-literal members were readonly by
// default in a .vibe file. An explicit source upgrade spells those modifiers.
// Methods and class fields never had that default; embedded modules are
// TypeScript. Dedicated source migrations own VibeLang declaration payloads.
func nativeTypeReadonlyMigrationFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	raw, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/type-readonly-upgrade.vibe", PathKey: "/type-readonly-upgrade.vibe"}, file.Text())
	mutableMembers := map[int]bool{}
	var declarations []core.TextRange
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxMutable {
			mutableMembers[form.Word.Pos()] = true
		}
		if form.Kind == parser.VibeSyntaxDeclaration {
			declarations = append(declarations, form.Range)
		}
	}
	seen := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(node) {
			return false
		}
		if (ast.IsPropertySignatureDeclaration(node) && node.Name() != nil) || ast.IsIndexSignatureDeclaration(node) {
			start := nodeStart(raw, node)
			for _, span := range declarations {
				if span.Pos() <= start && start < span.End() {
					return false
				}
			}
			writtenReadonly := false
			for _, modifier := range node.ModifierNodes() {
				if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
					writtenReadonly = true
				}
			}
			if !writtenReadonly && !mutableMembers[start] {
				anchor := node
				if node.Name() != nil {
					anchor = node.Name()
				}
				pos := nodeStart(raw, anchor)
				key := fmt.Sprintf("legacy-type-readonly:%d", pos)
				if !seen[pos] && !refused[key] {
					seen[pos] = true
					result.fixes = append(result.fixes, fileFix{label: nativeTypeReadonlyLabel, key: key, edits: []sourceEdit{{pos, pos, "readonly "}}})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	raw.AsNode().ForEachChild(visit)
	return result
}
