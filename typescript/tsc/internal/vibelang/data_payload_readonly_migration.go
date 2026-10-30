package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const dataPayloadReadonlyLabel = "data payload readonly keys"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, dataPayloadReadonlyMigrationFixes)
}

// An old data payload used the historical Vibe type-member readonly default.
// Spell those nested modifiers before the new parser preserves TypeScript
// mutability. The variant's own properties remain TaggedEnum's readonly fields.
func dataPayloadReadonlyMigrationFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/data-upgrade.vibe", PathKey: "/data-upgrade.vibe"}, file.Text())
	seen := map[int]bool{}
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxDeclaration || form.Name != "data" {
			continue
		}
		for _, variant := range form.Variants {
			if variant.Open.Len() == 0 || variant.Close.Len() == 0 {
				continue
			}
			start, end := variant.Open.Pos(), variant.Close.End()
			const prefix = "type $Payload = "
			text := prefix + file.Text()[start:end]
			// Ordinary type literals no longer synthesize readonly modifiers.
			// Read explicit modifiers and contextual mutable syntax instead of
			// relying on that retired parser default.
			raw, rawForms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/data-upgrade.vibe", PathKey: "/data-upgrade.vibe"}, text)
			mutableMembers := map[int]bool{}
			for _, syntax := range rawForms {
				if syntax.Kind == parser.VibeSyntaxMutable {
					mutableMembers[syntax.Word.Pos()] = true
				}
			}
			if len(raw.Statements.Nodes) != 1 || !ast.IsTypeAliasDeclaration(raw.Statements.Nodes[0]) {
				continue
			}
			fields := raw.Statements.Nodes[0].AsTypeAliasDeclaration().Type
			if !ast.IsTypeLiteralNode(fields) {
				continue
			}
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if (ast.IsPropertySignatureDeclaration(node) && node.Name() != nil) || ast.IsIndexSignatureDeclaration(node) {
					writtenReadonly := false
					for _, modifier := range node.ModifierNodes() {
						if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
							writtenReadonly = true
						}
					}
					if !writtenReadonly && !mutableMembers[nodeStart(raw, node)] {
						anchor := node
						if node.Name() != nil {
							anchor = node.Name()
						}
						pos := start + nodeStart(raw, anchor) - len(prefix)
						key := fmt.Sprintf("data-payload-readonly:%d", pos)
						if !seen[pos] && !refused[key] {
							seen[pos] = true
							result.fixes = append(result.fixes, fileFix{label: dataPayloadReadonlyLabel, key: key, edits: []sourceEdit{{pos, pos, "readonly "}}})
						}
					}
				}
				return node.ForEachChild(visit)
			}
			for _, field := range fields.Members() {
				if field.Type() != nil {
					visit(field.Type())
				}
			}
		}
	}
	return result
}
