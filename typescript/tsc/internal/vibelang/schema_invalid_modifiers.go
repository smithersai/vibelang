package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaTypeMemberModifiers)
	checker.RegisterDiagnosticsFilterHook(filterSchemaTypeMemberModifierDiagnostics)

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
