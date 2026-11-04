package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// TypeScript elides an unreferenced internal alias in an external module,
// except under verbatimModuleSyntax. Such an alias neither reads the host at
// runtime nor contributes to a declaration. Keep every source reference,
// including type references, and conservatively refuse comments/escapes rather
// than moving documentation or missing an escaped identifier.
func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: unusedPlatformAliasFix})
}

func unusedPlatformAliasFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	file := fix.SourceFile
	if !ast.IsExternalModule(file) || fix.Program.Options().VerbatimModuleSyntax.IsTrue() {
		return nil, nil
	}
	id := reportedNode(file, fix.Span, func(node *ast.Node) bool { return ast.IsIdentifier(node) || ast.IsQualifiedName(node) })
	if id == nil {
		return nil, nil
	}
	statement := ast.FindAncestor(id, ast.IsImportEqualsDeclaration)
	if statement == nil || statement.Parent == nil || !ast.IsSourceFile(statement.Parent) ||
		ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
		return nil, nil
	}
	anchored := false
	for _, other := range file.Statements.Nodes {
		if other == statement {
			continue
		}
		if ast.IsImportDeclaration(other) || ast.IsExportDeclaration(other) || ast.IsExportAssignment(other) || ast.HasSyntacticModifier(other, ast.ModifierFlagsExport) {
			anchored = true
			break
		}
	}
	if !anchored {
		return nil, nil
	}
	alias := statement.AsImportEqualsDeclaration()
	if alias.IsTypeOnly || !ast.IsQualifiedName(alias.ModuleReference) {
		return nil, nil
	}
	text := file.Text()
	if strings.Contains(text, "//") || strings.Contains(text, "/*") || strings.Contains(text, "\\") {
		return nil, nil
	}
	start, end := nodeStart(file, statement), statement.End()
	name := statement.Name().Text()
	if strings.Contains(text[:start], name) || strings.Contains(text[end:], name) {
		return nil, nil
	}
	if end < len(text) && text[end] == '\r' {
		end++
	}
	if end < len(text) && text[end] == '\n' {
		end++
	}
	return []*ls.CodeAction{{Description: "Remove erased unused platform alias", Changes: replaceRange(fix, start, end, "")}}, nil
}
