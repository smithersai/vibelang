package vibelang

import (
	"context"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaTypeMemberModifiers)
	checker.RegisterDiagnosticsFilterHook(filterSchemaTypeMemberModifierDiagnostics)
	registerNativeSchemaFix(1070)
	ls.RegisterCodeFixProvider(schemaTypeMemberModifierFix)
}

func checkSchemaTypeMemberModifiers(c *checker.Checker, file *ast.SourceFile) {
	for _, repair := range schemaTypeMemberRepairs(file) {
		if repair.code == 1070 {
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_modifier_cannot_appear_on_a_type_member, repair.name))
		}
	}
}

// Keep the same first grammar error when both independent schema grammar
// providers are installed. Nested fields retain their own diagnostics.
func filterSchemaTypeMemberModifierDiagnostics(_ *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	repairs := schemaTypeMemberRepairs(file)
	return slices.DeleteFunc(slices.Clone(all), func(d *ast.Diagnostic) bool {
		if d.Source() != "" || d.Code() != 1030 {
			return false
		}
		for _, repair := range repairs {
			if repair.code == 1070 && slices.Contains(repair.tokens, d.Loc()) &&
				slices.ContainsFunc(all, func(primary *ast.Diagnostic) bool {
					return primary.Source() == "" && primary.Code() == 1070 && primary.Pos() == repair.primary.Pos() && primary.End() == repair.primary.End()
				}) {
				return true
			}
		}
		return false
	})
}

var schemaTypeMemberModifierFix = &ls.CodeFixProvider{
	Source:     "",
	ErrorCodes: []int32{1070},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil {
			return nil, nil
		}
		if edits := schemaTypeMemberRepairEdits(fix); len(edits) > 0 {
			return []*ls.CodeAction{{Description: "Write the schema field without class-only modifiers", Changes: edits}}, nil
		}
		return nil, nil
	},
}
