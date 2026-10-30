package tsoptions

import (
	"maps"
	"path"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A project's VibeLang settings sit at the tsconfig's top level, where stock
// TypeScript and its tools ignore them (D275), or in compilerOptions.vibelang
// (design decision D34), which they reject as an unknown option:
//
//	"vibelang": {
//	  "diagnostics": { "EK9204": "off", "EK4403": "warning" },
//	  "tracing": "exported",
//	  "trustedPackages": ["@smthrs/*"],
//	  "declarationSidecars": true
//	}
//
// It is added by hand to the generated option tables: its declaration in
// declarations_generated.go; its parse, merge, comparison, and serialization
// cases in options_generated.go; and core.CompilerOptions.VibeLang.

var (
	// vibeLangAdjustableCodes are the EK codes whose category a project may
	// change. Every other EK diagnostic keeps its category.
	vibeLangAdjustableCodes = core.VibeLangAdjustableCodes
	vibeLangCategories      = []string{"error", "warning", "off"}
	vibeLangTracing         = []string{"none", "exported", "all"}
)

// parseVibeLangOptions reads a compilerOptions.vibelang value that
// validateVibeLangOptions accepted.
func parseVibeLangOptions(value any) *core.VibeLangOptions {
	object, ok := value.(*collections.OrderedMap[string, any])
	if !ok {
		return nil
	}
	options := &core.VibeLangOptions{}
	if codes, ok := object.GetOrZero("diagnostics").(*collections.OrderedMap[string, any]); ok {
		for code, category := range codes.Entries() {
			if category, ok := category.(string); ok && slices.Contains(vibeLangAdjustableCodes, code) && slices.Contains(vibeLangCategories, category) {
				if options.Diagnostics == nil {
					options.Diagnostics = make(map[string]string)
				}
				options.Diagnostics[code] = category
			}
		}
	}
	if tracing, ok := object.GetOrZero("tracing").(string); ok && slices.Contains(vibeLangTracing, tracing) {
		options.Tracing = tracing
	}
	if sidecars, ok := object.GetOrZero("declarationSidecars").(bool); ok {
		options.DeclarationSidecars = sidecars
	}
	if packages, ok := object.GetOrZero("trustedPackages").([]any); ok {
		for _, entry := range packages {
			if pattern, ok := entry.(string); ok {
				if _, err := path.Match(pattern, ""); err == nil {
					options.TrustedPackages = append(options.TrustedPackages, pattern)
				}
			}
		}
	}
	return options
}

// validateVibeLangOptions reports each unknown key and invalid value in a
// compilerOptions.vibelang value, at its node in the tsconfig file.
func validateVibeLangOptions(value any, valueExpression *ast.Expression, sourceFile *ast.SourceFile) []*ast.Diagnostic {
	object, ok := value.(*collections.OrderedMap[string, any])
	if !ok {
		return nil // convertJsonOption already reported that the value is not an object
	}
	var errors []*ast.Diagnostic
	report := func(node *ast.Node, message *diagnostics.Message, args ...any) *ast.Diagnostic {
		d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(sourceFile, node, message, args...)
		errors = append(errors, d)
		return d
	}
	notAdjustable := func(node *ast.Node, code string) {
		// Keep the option path and location, but explain the policy
		// instead of calling an EK code an unknown compiler option.
		d := report(node, diagnostics.Unknown_compiler_option_0, "vibelang.diagnostics."+code)
		d = ast.NewExternalDiagnostic(d.File(), d.Loc(), "", d.Category(), d.Code(), "vibelang.diagnostics."+code+" is not adjustable; its diagnostic category cannot be configured.")
		errors[len(errors)-1] = d
		d.AddMessageChain(ast.NewExternalDiagnostic(nil, core.TextRange{}, "", diagnostics.CategoryMessage, 0,
			"Only these EK codes can be configured: "+strings.Join(vibeLangAdjustableCodes, ", ")+"."))
	}
	for key, v := range object.Entries() {
		property := jsonProperty(valueExpression, key)
		switch key {
		case "diagnostics":
			codes, ok := v.(*collections.OrderedMap[string, any])
			if !ok {
				report(jsonInitializer(property), diagnostics.Compiler_option_0_requires_a_value_of_type_1, "vibelang.diagnostics", "object")
				continue
			}
			for code, category := range codes.Entries() {
				codeProperty := jsonProperty(jsonInitializer(property), code)
				if !slices.Contains(vibeLangAdjustableCodes, code) {
					notAdjustable(jsonName(codeProperty), code)
					continue
				}
				if category, ok := category.(string); !ok || !slices.Contains(vibeLangCategories, category) {
					report(jsonInitializer(codeProperty), diagnostics.Argument_for_0_option_must_be_Colon_1, "vibelang.diagnostics."+code, quoteList(vibeLangCategories))
				}
			}
			for _, name := range jsonEmptyNames(jsonInitializer(property)) {
				notAdjustable(name, "")
			}
		case "trustedPackages":
			entries, ok := v.([]any)
			if !ok {
				report(jsonInitializer(property), diagnostics.Compiler_option_0_requires_a_value_of_type_1, "vibelang.trustedPackages", "Array")
				continue
			}
			var elements []*ast.Node
			if expression := jsonInitializer(property); expression != nil && ast.IsArrayLiteralExpression(expression) {
				elements = expression.AsArrayLiteralExpression().Elements.Nodes
			}
			for i, entry := range entries {
				var element *ast.Node
				if i < len(elements) {
					element = elements[i]
				}
				pattern, ok := entry.(string)
				if !ok {
					report(element, diagnostics.Compiler_option_0_requires_a_value_of_type_1, "vibelang.trustedPackages", "string")
				} else if _, err := path.Match(pattern, ""); err != nil {
					report(element, diagnostics.Argument_for_0_option_must_be_Colon_1, "vibelang.trustedPackages", "a valid package-name glob")
				}
			}
		case "tracing":
			if tracing, ok := v.(string); !ok || !slices.Contains(vibeLangTracing, tracing) {
				report(jsonInitializer(property), diagnostics.Argument_for_0_option_must_be_Colon_1, "vibelang.tracing", quoteList(vibeLangTracing))
			}
		case "declarationSidecars":
			if _, ok := v.(bool); !ok {
				report(jsonInitializer(property), diagnostics.Compiler_option_0_requires_a_value_of_type_1, "vibelang.declarationSidecars", "boolean")
			}
		default:
			report(jsonName(property), diagnostics.Unknown_compiler_option_0, "vibelang."+key)
		}
	}
	// The JSON conversion drops a property whose name is empty, as stock
	// TypeScript does in every object, so the entries above never hold one;
	// "" is no setting of Chapter 28's options table.
	for _, name := range jsonEmptyNames(valueExpression) {
		report(name, diagnostics.Unknown_compiler_option_0, "vibelang.")
	}
	return errors
}

// serializeVibeLangOptions writes options as tsconfig JSON for --showConfig.
func serializeVibeLangOptions(options *core.VibeLangOptions) *collections.OrderedMap[string, any] {
	result := collections.NewOrderedMapWithSizeHint[string, any](3)
	if len(options.TrustedPackages) > 0 {
		packages := make([]any, len(options.TrustedPackages))
		for i, pattern := range options.TrustedPackages {
			packages[i] = pattern
		}
		result.Set("trustedPackages", packages)
	}
	if len(options.Diagnostics) > 0 {
		codes := collections.NewOrderedMapWithSizeHint[string, any](len(options.Diagnostics))
		for _, code := range slices.Sorted(maps.Keys(options.Diagnostics)) {
			codes.Set(code, options.Diagnostics[code])
		}
		result.Set("diagnostics", codes)
	}
	if options.Tracing != "" {
		result.Set("tracing", options.Tracing)
	}
	if options.DeclarationSidecars {
		result.Set("declarationSidecars", true)
	}
	return result
}

// jsonProperty returns the property named name in object, a JSON object
// literal, or nil.
func jsonProperty(object *ast.Node, name string) *ast.Node {
	if object == nil || !ast.IsObjectLiteralExpression(object) {
		return nil
	}
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		if ast.IsPropertyAssignment(property) && property.Name() != nil && property.Name().Text() == name {
			return property
		}
	}
	return nil
}

// jsonEmptyNames returns the name of each property of a JSON object literal
// whose name is the empty string.
func jsonEmptyNames(object *ast.Node) []*ast.Node {
	if object == nil || !ast.IsObjectLiteralExpression(object) {
		return nil
	}
	var names []*ast.Node
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		if ast.IsPropertyAssignment(property) && property.Name() != nil && ast.IsStringLiteral(property.Name()) && property.Name().Text() == "" {
			names = append(names, property.Name())
		}
	}
	return names
}

func jsonName(property *ast.Node) *ast.Node {
	if property == nil {
		return nil
	}
	return property.Name()
}

func jsonInitializer(property *ast.Node) *ast.Node {
	if property == nil {
		return nil
	}
	return property.Initializer()
}

func quoteList(values []string) string {
	return "'" + strings.Join(values, "', '") + "'"
}
