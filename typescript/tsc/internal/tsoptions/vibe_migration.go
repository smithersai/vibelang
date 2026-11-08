package tsoptions

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func configObject(file *ast.SourceFile) *ast.Node {
	if file == nil || len(file.Statements.Nodes) == 0 {
		return nil
	}
	statement := file.Statements.Nodes[0]
	if !ast.IsExpressionStatement(statement) {
		return nil
	}
	return statement.AsExpressionStatement().Expression
}

func legacySeverityProperties(file *ast.SourceFile) []*ast.Node {
	root := configObject(file)
	var properties []*ast.Node
	for _, object := range []*ast.Node{root, jsonInitializer(jsonProperty(root, "compilerOptions"))} {
		legacy := jsonInitializer(jsonProperty(object, "vibelang"))
		if property := jsonProperty(legacy, "diagnostics"); property != nil {
			properties = append(properties, property)
		}
	}
	return properties
}

func configMigrationWarnings(file *ast.SourceFile) []*ast.Diagnostic {
	var result []*ast.Diagnostic
	for _, property := range legacySeverityProperties(file) {
		d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, property.Name(), diagnostics.Unknown_compiler_option_0, "vibelang.diagnostics")
		result = append(result, ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryWarning, core.VibeLegacyConfigCode, core.VibeConfigDiagnostics[core.VibeLegacyConfigCode]))
	}
	// Retirement warnings belong to the declaring config, even if a child
	// replaces the section. Never validate or retain their values.
	root := configObject(file)
	for _, section := range []struct {
		object *ast.Node
		modern bool
	}{
		{jsonInitializer(jsonLastProperty(root, "vibelang")), false},
		{jsonInitializer(jsonLastProperty(jsonInitializer(jsonLastProperty(root, "compilerOptions")), "vibelang")), false},
		{jsonInitializer(jsonLastProperty(root, "vibe")), true},
	} {
		if section.object == nil || !ast.IsObjectLiteralExpression(section.object) {
			continue
		}
		for _, property := range section.object.AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(property) || property.Name() == nil || !ast.IsPropertyNameLiteral(property.Name()) {
				continue
			}
			key := property.Name().Text()
			code := core.VibeRetiredTrustedPackagesCode
			if key == "declarationImportStyle" && !section.modern {
				code = core.VibeRetiredDeclarationStyleCode
			} else if key != "trustedPackages" {
				continue
			}
			d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, property.Name(), diagnostics.Unknown_compiler_option_0, key)
			result = append(result, ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryWarning, code, core.VibeConfigDiagnostics[code]))
		}
	}
	return result
}

// Apply the final project settings to inherited migration warnings as well.
// Clone diagnostics: an extended config is shared by sibling projects.
func applyConfigSeverities(ds []*ast.Diagnostic, options *core.VibeLangOptions) []*ast.Diagnostic {
	if options == nil {
		return ds
	}
	var result []*ast.Diagnostic
	for _, d := range ds {
		if d.Source() == "EK" && (d.Code() == core.VibeLegacyConfigCode || d.Code() == core.VibeRetiredTrustedPackagesCode || d.Code() == core.VibeRetiredDeclarationStyleCode || d.Code() == core.VibeLintPluginCode) {
			category := diagnostics.CategoryWarning
			switch options.Severities["EK"+strconv.FormatInt(int64(d.Code()), 10)] {
			case "off":
				continue
			case "error":
				category = diagnostics.CategoryError
			case "suggestion":
				category = diagnostics.CategorySuggestion
			}
			d = ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", category, d.Code(), d.MessageText())
		}
		result = append(result, d)
	}
	return result
}
