package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const schemaTupleLegacyLabel = "nested tuple compatibility"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, schemaTupleLegacyMigrationFixes)
}

// Only explicit migration-only opts into the unchecked alias behavior of the
// older compiler. Ordinary fixes keep the new, valid tuple schema mappings.
func schemaTupleLegacyMigrationFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	type span struct{ start, end int }
	nested := map[int]map[span]bool{}
	var aliases func(*ast.Node) bool
	aliases = func(node *ast.Node) bool {
		if isSchemaAlias(node) && node.Name() != nil && node.Initializer() != nil {
			parent := node.Parent
			if parent != nil && parent.Kind == ast.KindVariableDeclarationList {
				parent = parent.Parent
			}
			if parent != nil && parent.Kind == ast.KindVariableStatement {
				parent = parent.Parent
			}
			if parent != nil && parent != file.AsNode() {
				mapped := map[span]bool{}
				var collect func(*ast.Node) bool
				collect = func(value *ast.Node) bool {
					if isSchemaStruct(value) {
						return false // struct fields were already checked
					}
					if value.Flags&ast.NodeFlagsReparsed != 0 || isUnsupportedSchema(value) || (ast.IsCallExpression(value) && value.Expression().Flags&ast.NodeFlagsReparsed != 0) {
						mapped[span{value.Pos(), value.End()}] = true
					}
					return value.ForEachChild(collect)
				}
				collect(node.Initializer())
				nested[node.Name().End()] = mapped
			}
		}
		return node.ForEachChild(aliases)
	}
	file.AsNode().ForEachChild(aliases)
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/tuple-upgrade.vibe", PathKey: "/tuple-upgrade.vibe"}, file.Text())
	for _, form := range forms {
		mapped := nested[form.Head.End()]
		if form.Name != parser.VibeSyntaxSchemaAlias || mapped == nil {
			continue
		}
		text := []byte(file.Text()[:form.Range.End()])
		for i := 0; i < form.Range.Pos(); i++ {
			if text[i] != '\n' && text[i] != '\r' {
				text[i] = ' '
			}
		}
		copy(text[form.Head.Pos():form.Head.Pos()+6], "type  ")
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/tuple-upgrade.ts", PathKey: "/tuple-upgrade.ts"}, string(text), core.ScriptKindTS)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsTupleTypeNode(node) && mapped[span{node.Pos(), node.End()}] {
				unsupported := false
				for _, item := range node.AsTupleTypeNode().Elements.Nodes {
					unsupported = unsupported || item.Kind == ast.KindNamedTupleMember || item.Kind == ast.KindOptionalType || item.Kind == ast.KindRestType
				}
				if unsupported {
					target := node
					if parent := node.Parent; parent != nil && parent.Kind == ast.KindTypeOperator && parent.AsTypeOperatorNode().Operator == ast.KindReadonlyKeyword {
						target = parent
					}
					start, end := nodeStart(raw, target), target.End()
					key := fmt.Sprintf("nested-tuple-compat:%d:%d", start, end)
					if !refused[key] {
						result.fixes = append(result.fixes, fileFix{label: schemaTupleLegacyLabel, key: key, edits: []sourceEdit{{start, end, "Schema.Unknown"}}})
					}
					return false // the old lowering never entered this tuple
				}
			}
			return node.ForEachChild(visit)
		}
		for _, statement := range raw.Statements.Nodes {
			if ast.IsTypeAliasDeclaration(statement) {
				visit(statement.AsTypeAliasDeclaration().Type)
			}
		}
	}
	return result
}
