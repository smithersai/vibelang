package tsoptions

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"maps"
	"slices"
)

// parseVibeSettings validates VIP-30 settings, retaining source spans in JSONC.
// Severity-entry errors are EK3006; other errors are EK3007.
func parseVibeSettings(value any, expression *ast.Node, file *ast.SourceFile) (*core.VibeLangOptions, []*ast.Diagnostic) {
	options := &core.VibeLangOptions{VibeOnly: true}
	var errors []*ast.Diagnostic
	report := func(node *ast.Node, code int32, text string) {
		d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, node, diagnostics.Unknown_compiler_option_0, "vibe")
		errors = append(errors, ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryError, code, text))
	}
	object, ok := value.(*collections.OrderedMap[string, any])
	if !ok {
		report(expression, core.VibeInvalidConfigCode, "vibe must be an object; put language options inside an object.")
		return options, errors
	}
	for key, value := range object.Entries() {
		property := jsonProperty(expression, key)
		node := jsonInitializer(property)
		switch key {
		case "effectGlobals", "effectModules":
			b, ok := value.(bool)
			if !ok {
				report(node, core.VibeInvalidConfigCode, "vibe."+key+" must be a boolean; use true or false.")
				continue
			}
			setting := core.TSFalse
			if b {
				setting = core.TSTrue
			}
			if key == "effectGlobals" {
				options.EffectGlobals = setting
			} else {
				options.EffectModules = setting
			}
		case "severities":
			codes, ok := value.(*collections.OrderedMap[string, any])
			if !ok {
				report(node, core.VibeInvalidConfigCode, "vibe.severities must be an object mapping diagnostic codes to severities.")
				continue
			}
			options.Severities = map[string]string{}
			for code, value := range codes.Entries() {
				entry := jsonProperty(node, code)
				if !core.VibeSeverityCode(code) {
					report(jsonName(entry), core.VibeInvalidSeverityCode, fmt.Sprintf("%s cannot appear in vibe.severities; remove the entry. Only warning codes and assigned EK38 lint codes can be configured.", code))
					continue
				}
				severity, ok := value.(string)
				if !ok || !slices.Contains([]string{"error", "warning", "suggestion", "off"}, severity) {
					report(jsonInitializer(entry), core.VibeInvalidSeverityCode, "vibe.severities."+code+" must be error, warning, suggestion or off; replace this value.")
					continue
				}
				options.Severities[code] = severity
			}
			for _, name := range jsonEmptyNames(node) {
				report(name, core.VibeInvalidSeverityCode, "An empty diagnostic code cannot appear in vibe.severities; remove the entry.")
			}
		default:
			report(jsonName(property), core.VibeInvalidConfigCode, "Unknown vibe option "+key+"; use effectGlobals, effectModules or severities, or remove the option.")
		}
	}
	for _, name := range jsonEmptyNames(expression) {
		report(name, core.VibeInvalidConfigCode, "An empty key is not a vibe option; remove it.")
	}
	return options, errors
}

func serializeVibeSettings(options *core.VibeLangOptions) *collections.OrderedMap[string, any] {
	if options.Severities == nil && options.EffectGlobals == core.TSUnknown && options.EffectModules == core.TSUnknown {
		if options.VibeOnly {
			return collections.NewOrderedMapWithSizeHint[string, any](0)
		}
		return nil
	}
	result := collections.NewOrderedMapWithSizeHint[string, any](3)
	if options.EffectGlobals != core.TSUnknown {
		result.Set("effectGlobals", options.EffectGlobals == core.TSTrue)
	}
	if options.EffectModules != core.TSUnknown {
		result.Set("effectModules", options.EffectModules == core.TSTrue)
	}
	if options.Severities != nil {
		codes := collections.NewOrderedMapWithSizeHint[string, any](len(options.Severities))
		for _, code := range slices.Sorted(maps.Keys(options.Severities)) {
			codes.Set(code, options.Severities[code])
		}
		result.Set("severities", codes)
	}
	return result
}
