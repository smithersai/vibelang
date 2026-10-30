package tsoptions

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"maps"
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

func legacySeverityWarnings(file *ast.SourceFile) []*ast.Diagnostic {
	var result []*ast.Diagnostic
	for _, property := range legacySeverityProperties(file) {
		d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, property.Name(), diagnostics.Unknown_compiler_option_0, "vibelang.diagnostics")
		result = append(result, ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryWarning, core.VibeLegacyConfigCode, core.VibeConfigDiagnostics[core.VibeLegacyConfigCode]))
	}
	return result
}

type configEdit struct {
	start, end int
	text       string
}

// MigrateLegacySeverities moves legacy diagnostic settings while retaining
// JSONC comments and unrelated options. Existing release entries win.
func MigrateLegacySeverities(name tspath.RootedFilePath, text string) (string, bool) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.PathKey(name)}, text, core.ScriptKindJSON)
	if len(file.Diagnostics()) != 0 {
		return text, false
	}
	properties := legacySeverityProperties(file)
	if len(properties) == 0 {
		return text, false
	}
	root := configObject(file)
	vibe := jsonInitializer(jsonProperty(root, "vibe"))
	severities := jsonInitializer(jsonProperty(vibe, "severities"))
	if vibe != nil && !ast.IsObjectLiteralExpression(vibe) || severities != nil && !ast.IsObjectLiteralExpression(severities) {
		return text, false
	}
	entries := map[string]string{}
	var edits []configEdit
	for _, property := range properties {
		value := property.Initializer()
		if !ast.IsObjectLiteralExpression(value) {
			return text, false
		}
		movable := true
		for _, entry := range value.AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(entry) || !core.VibeSeverityCode(entry.Name().Text()) {
				movable = false
				break
			}
		}
		// Former policy errors have no legal release severity. Retain them rather
		// than turn a previously valid project into an EK3006 config error.
		if !movable {
			continue
		}
		for _, entry := range value.AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(entry) {
				return text, false
			}
			key := entry.Name().Text()
			if jsonProperty(severities, key) == nil {
				entries[key] = strings.TrimSpace(text[entry.Pos():entry.End()])
			}
		}
		// Remove diagnostics; retain other legacy options. Remove an empty wrapper.
		parent := property.Parent
		remove := property
		object := parent
		if len(parent.AsObjectLiteralExpression().Properties.Nodes) == 1 {
			remove = parent.Parent
			object = remove.Parent
		}
		siblings := object.AsObjectLiteralExpression().Properties.Nodes
		start, end := scanner.GetRangeOfTokenAtPosition(file, remove.Pos()).Pos(), remove.End()
		index := slices.Index(siblings, remove)
		comma := scanner.GetRangeOfTokenAtPosition(file, end)
		if text[comma.Pos():comma.End()] == "," {
			end = comma.End()
		} else if index > 0 {
			comma = scanner.GetRangeOfTokenAtPosition(file, siblings[index-1].End())
			if text[comma.Pos():comma.End()] == "," {
				edits = append(edits, configEdit{comma.Pos(), comma.End(), ""})
			}
		}
		edits = append(edits, configEdit{start, end, ""})
	}
	if len(edits) == 0 {
		return text, false
	}
	var values []string
	for _, key := range slices.Sorted(maps.Keys(entries)) {
		values = append(values, entries[key])
	}
	if len(values) > 0 {
		insertion := strings.Join(values, ", ")
		object := severities
		if object == nil {
			insertion = "\"severities\": {" + insertion + "}"
			object = vibe
		}
		if object == nil {
			insertion = "\"vibe\": {" + insertion + "}"
			object = root
		}
		if len(object.AsObjectLiteralExpression().Properties.Nodes) > 0 {
			insertion += ","
		}
		// Pos includes trivia; a brace in a JSONC comment is not the opening token.
		start := scanner.GetRangeOfTokenAtPosition(file, object.Pos()).End()
		edits = append(edits, configEdit{start, start, insertion})
	}
	slices.SortFunc(edits, func(a, b configEdit) int { return b.start - a.start })
	for _, edit := range edits {
		text = text[:edit.start] + edit.text + text[edit.end:]
	}
	// Parse the result before writing, including the case where the removed
	// legacy wrapper was the root object last property.
	if _, errors := ParseConfigFileTextToJson(name, tspath.PathKey(name), text); len(errors) != 0 {
		return file.Text(), false
	}
	return text, true
}

// Apply the final project settings to inherited migration warnings as well.
// Clone diagnostics: an extended config is shared by sibling projects.
func applyConfigSeverities(ds []*ast.Diagnostic, options *core.VibeLangOptions) []*ast.Diagnostic {
	if options == nil {
		return ds
	}
	var result []*ast.Diagnostic
	for _, d := range ds {
		if d.Source() == "EK" && d.Code() == core.VibeLegacyConfigCode {
			category := diagnostics.CategoryWarning
			switch options.Severities["EK3009"] {
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
