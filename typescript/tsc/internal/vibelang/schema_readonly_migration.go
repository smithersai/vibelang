package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const schemaReadonlyLabel = "schema readonly keys"

func init() {
	// Write source modifiers before a codec expansion consumes the declaration.
	sourceFileMigrations = append([]sourceFileMigration{schemaReadonlyMigrationFixes}, sourceFileMigrations...)
	legacySchemaTypeMigrations = append(legacySchemaTypeMigrations, preserveLegacySchemaReadonlyType)
}

func schemaReadonlyMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/readonly-source.vibe", PathKey: "/readonly-source.vibe"}, file.Text())
	seen := map[int]bool{}
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxDeclaration || (form.Name != "schema" && form.Name != parser.VibeSyntaxSchemaAlias && form.Name != "schema error") {
			continue
		}
		start, end := form.Range.Pos(), form.Range.End()
		text := []byte(file.Text()[:end])
		for i := 0; i < start; i++ {
			if text[i] != '\n' && text[i] != '\r' {
				text[i] = ' '
			}
		}
		head := form.Head.Pos()
		switch form.Name {
		case "schema":
			open := form.Open.Pos()
			for i := head; i < open; i++ {
				if text[i] != '\n' && text[i] != '\r' {
					text[i] = ' '
				}
			}
			copy(text[head:], "type T=")
		case parser.VibeSyntaxSchemaAlias:
			copy(text[head:head+6], "type  ")
		case "schema error":
			copy(text[head:head+6], "      ")
			errorPos := scanner.SkipTrivia(file.Text(), head+6)
			copy(text[errorPos:errorPos+5], "class")
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/readonly-source.vibe", PathKey: "/readonly-source.vibe"}, string(text), core.ScriptKindTS)
		local := proposal{file: file}
		defaults := map[int]bool{}
		var visitType func(*ast.Node) bool
		visitType = func(n *ast.Node) bool {
			if legacySchemaReadonlyProperty(raw, n, forms) {
				pos := nodeStart(raw, n.Name())
				key := fmt.Sprintf("schema-readonly:%d:%s", pos, expressionText(raw, n.Name()))
				defaults[pos] = true
				if !seen[pos] && !refused[key] {
					seen[pos] = true
					local.fixes = append(local.fixes, fileFix{label: schemaReadonlyLabel, key: key, edits: []sourceEdit{{pos, pos, "readonly "}}})
				}
			}
			return n.ForEachChild(visitType)
		}
		for _, statement := range raw.Statements.Nodes {
			if ast.IsTypeAliasDeclaration(statement) {
				visitType(statement.AsTypeAliasDeclaration().Type)
			}
			if ast.IsClassDeclaration(statement) {
				for _, member := range statement.AsClassDeclaration().Members.Nodes {
					if ast.IsPropertyDeclaration(member) && member.Type() != nil {
						visitType(member.Type())
					}
				}
			}
		}
		if len(defaults) > 0 {
			edits, needed := schemaReadonlyCodecUpgrade(ctx, program, file, form.Head.Pos(), form.Head.End(), defaults)
			if needed {
				key := fmt.Sprintf("schema-readonly-codec:%d", form.Head.Pos())
				if len(edits) > 0 && !refused[key] {
					result = result.withFixes(proposal{file: file, fixes: []fileFix{{label: schemaReadonlyLabel, key: key, edits: edits}}})
				}
			} else {
				result = result.withFixes(local)
			}
		}
	}
	// The ordinary project fix gate refuses a migration that would add an error in another source file.
	return result
}

// Grouped codec expansions also reparse nested object types. Write their old
// readonly defaults before the new parser turns those types into schema fields.
func preserveLegacySchemaReadonlyType(typ string) string {
	const prefix = "type $Migration = "
	raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/readonly-type.vibe", PathKey: "/readonly-type.vibe"}, prefix+typ, core.ScriptKindTS)
	if len(raw.Statements.Nodes) != 1 || !ast.IsTypeAliasDeclaration(raw.Statements.Nodes[0]) {
		return typ
	}
	return schemaTypeKeyBody(raw, raw.Statements.Nodes[0], len(prefix), len(prefix)+len(typ), false)
}
