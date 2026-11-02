package tsoptions

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"maps"
	"slices"
)

// parseVibeSettings validates VIP-30 settings, retaining source spans in JSONC.
// Severity-entry diagnostics are deferred until after the extends merge. A nil
// entry records a valid override that displaces an ancestor's diagnostic.
func parseVibeSettings(value any, expression *ast.Node, file *ast.SourceFile, basePath tspath.RootedDirectoryPath) (*core.VibeLangOptions, []*ast.Diagnostic, map[string]*ast.Diagnostic) {
	options := &core.VibeLangOptions{VibeOnly: true}
	var errors []*ast.Diagnostic
	severityDiagnostics := map[string]*ast.Diagnostic{}
	diagnostic := func(node *ast.Node, code int32, text string) *ast.Diagnostic {
		d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, node, diagnostics.Unknown_compiler_option_0, "vibe")
		return ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryError, code, text)
	}
	report := func(node *ast.Node, code int32, text string) {
		errors = append(errors, diagnostic(node, code, text))
	}
	object, ok := value.(*collections.OrderedMap[string, any])
	if !ok {
		report(expression, core.VibeInvalidConfigCode, "vibe must be an object; put language options inside an object.")
		return options, errors, severityDiagnostics
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
		case "sidecarDir":
			// A relative directory resolves from the config that declares it;
			// a leading ${configDir} waits for the selected config's directory.
			directory, ok := value.(string)
			if !ok {
				report(node, core.VibeInvalidConfigCode, "vibe.sidecarDir must be a path string; use a path such as \".vibe/declarations\".")
				continue
			}
			if !startsWithConfigDirTemplate(directory) && basePath != "" {
				directory = tspath.GetNormalizedAbsolutePath(directory, basePath)
			}
			options.SidecarDir = directory
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
					severityDiagnostics[code] = diagnostic(jsonName(entry), core.VibeInvalidSeverityCode, fmt.Sprintf("%s cannot appear in vibe.severities; remove the entry. Only warning codes and assigned EK38 lint codes can be configured.", code))
					continue
				}
				severity, ok := value.(string)
				if !ok || !slices.Contains([]string{"error", "warning", "suggestion", "off"}, severity) {
					if options.InvalidSeverities == nil {
						options.InvalidSeverities = map[string]bool{}
					}
					options.InvalidSeverities[code] = true
					severityDiagnostics[code] = diagnostic(jsonInitializer(entry), core.VibeInvalidSeverityCode, "vibe.severities."+code+" must be error, warning, suggestion or off; replace this value.")
					continue
				}
				severityDiagnostics[code] = nil
				options.Severities[code] = severity
			}
			for _, name := range jsonEmptyNames(node) {
				severityDiagnostics[""] = diagnostic(name, core.VibeInvalidSeverityCode, "An empty diagnostic code cannot appear in vibe.severities; remove the entry.")
			}
		default:
			report(jsonName(property), core.VibeInvalidConfigCode, "Unknown vibe option "+key+"; use effectGlobals, effectModules, severities or sidecarDir, or remove the option.")
		}
	}
	for _, name := range jsonEmptyNames(expression) {
		report(name, core.VibeInvalidConfigCode, "An empty key is not a vibe option; remove it.")
	}
	return options, errors, severityDiagnostics
}

func serializeVibeSettings(options *core.VibeLangOptions, configFileName tspath.RootedFilePath, caseSensitivity tspath.CaseSensitivity) *collections.OrderedMap[string, any] {
	if options.Severities == nil && options.EffectGlobals == core.TSUnknown && options.EffectModules == core.TSUnknown && options.SidecarDir == "" {
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
	if options.SidecarDir != "" {
		directory := options.SidecarDir
		if configFileName != "" && tspath.IsRootedDiskPath(directory) {
			directory = tspath.GetRelativePathFromDirectory(configFileName.Directory().AsString(), directory, caseSensitivity)
		}
		result.Set("sidecarDir", directory)
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

// Merge without mutating the cached base: sibling projects can select different
// winners from the same extended config, including a later invalid winner.
func mergeVibeSeverityDiagnostics(base, child map[string]*ast.Diagnostic) map[string]*ast.Diagnostic {
	result := maps.Clone(base)
	if len(child) != 0 {
		if result == nil {
			result = map[string]*ast.Diagnostic{}
		}
		maps.Copy(result, child)
	}
	return result
}
