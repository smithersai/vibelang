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
		switch repair.code {
		case 1090:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_modifier_cannot_appear_on_a_parameter, repair.name))
		case 1030:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_modifier_already_seen, repair.name))
		case 2369:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.A_parameter_property_is_only_allowed_in_a_constructor_implementation))
		case 1212:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.Identifier_expected_0_is_a_reserved_word_in_strict_mode, repair.name))
		case 1213:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.Identifier_expected_0_is_a_reserved_word_in_strict_mode_Class_definitions_are_automatically_in_strict_mode, repair.name))
		case 1214:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.Identifier_expected_0_is_a_reserved_word_in_strict_mode_Modules_are_automatically_in_strict_mode, repair.name))
		case 1262:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.Identifier_expected_0_is_a_reserved_word_at_the_top_level_of_a_module, repair.name))
		case 1359:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.Identifier_expected_0_is_a_reserved_word_that_cannot_be_used_here, repair.name))
		case 1070:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_modifier_cannot_appear_on_a_type_member, repair.name))
		case 1024:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_readonly_modifier_can_only_appear_on_a_property_declaration_or_index_signature))
		case 17019:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_at_the_end_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1, repair.name, repair.written))
		case 17020:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.X_0_at_the_start_of_a_type_is_not_valid_TypeScript_syntax_Did_you_mean_to_write_1, repair.name, repair.written))
		case 8020:
			c.AddDiagnostic(ast.NewDiagnostic(file, repair.primary, diagnostics.JSDoc_types_can_only_be_used_inside_documentation_comments))
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
