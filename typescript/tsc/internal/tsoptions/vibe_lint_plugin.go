package tsoptions

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func rawLintPlugins(raw any) ([]any, bool) {
	root, ok := raw.(*collections.OrderedMap[string, any])
	if !ok || root == nil {
		return nil, false
	}
	options, ok := root.GetOrZero("compilerOptions").(*collections.OrderedMap[string, any])
	if !ok || options == nil {
		return nil, false
	}
	value, has := options.Get("plugins")
	plugins, _ := value.([]any)
	return plugins, has
}

func lintPluginMigrationWarnings(config *ParsedCommandLine) []*ast.Diagnostic {
	if !core.VibeNeedsLintPlugin(config.CompilerOptions()) {
		return nil
	}
	file := config.ConfigFile.SourceFile
	node := jsonProperty(configObject(file), "vibe")
	if node == nil {
		node = jsonProperty(configObject(file), "extends")
	}
	if node == nil {
		node = configObject(file)
	}
	d := CreateDiagnosticForNodeInSourceFileOrCompilerDiagnostic(file, node, diagnostics.Unknown_compiler_option_0, "plugins")
	return []*ast.Diagnostic{ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", diagnostics.CategoryWarning, core.VibeLintPluginCode, core.VibeLintPluginMessage)}
}

// MigrateLintPlugin materializes resolved inherited entries in the selected
// config, or appends to its authored array without moving comments or options.
// Call only when the resolved project needs the VIP-38 preserving transition.
func MigrateLintPlugin(name tspath.RootedFilePath, text string, inherited []any) (string, bool) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.PathKey(name)}, text, core.ScriptKindJSON)
	if len(file.Diagnostics()) != 0 {
		return text, false
	}
	root := configObject(file)
	if root == nil || !ast.IsObjectLiteralExpression(root) {
		return text, false
	}
	options := jsonInitializer(jsonLastProperty(root, "compilerOptions"))
	if options != nil && !ast.IsObjectLiteralExpression(options) {
		return text, false
	}
	plugin := `{"name":"@effect/language-service"}`
	var pos int
	var insertion string
	if property := jsonLastProperty(options, "plugins"); property != nil {
		array := property.Initializer()
		if array == nil || !ast.IsArrayLiteralExpression(array) {
			return text, false
		}
		for _, element := range array.AsArrayLiteralExpression().Elements.Nodes {
			value := jsonInitializer(jsonLastProperty(element, "name"))
			if value != nil && ast.IsStringLiteral(value) && value.Text() == "@effect/language-service" {
				return text, false
			}
		}
		// Tokenize the array so a trailing comment or comma remains authored trivia.
		body := text[array.Pos() : array.End()-1]
		tokens := scanner.NewScanner()
		tokens.SetText(body)
		tokens.SetSkipTrivia(true)
		last := ast.KindUnknown
		for token := tokens.Scan(); token != ast.KindEndOfFile; token = tokens.Scan() {
			last = token
		}
		prefix := ""
		if len(array.AsArrayLiteralExpression().Elements.Nodes) > 0 && last != ast.KindCommaToken {
			prefix = ","
		}
		pos = array.End() - 1
		insertion = "\n" + prefix + plugin + "\n"
	} else {
		entries := inherited
		if entries == nil {
			entries = []any{}
		}
		payload, err := json.Marshal(entries)
		if err != nil {
			return text, false
		}
		body := strings.TrimSpace(string(payload))
		if !strings.HasPrefix(body, "[") || !strings.HasSuffix(body, "]") {
			return text, false
		}
		body = strings.TrimSpace(body[1 : len(body)-1])
		if body != "" {
			body += ","
		}
		insertion = `"plugins":[` + body + plugin + "]"
		object := options
		if object == nil {
			insertion = `"compilerOptions":{` + insertion + "}"
			object = root
		}
		if len(object.AsObjectLiteralExpression().Properties.Nodes) > 0 {
			insertion += ","
		}
		// Pos may include leading trivia; locate the actual opening brace.
		open := scanner.GetRangeOfTokenAtPosition(file, object.Pos()).Pos()
		pos = open + 1
		insertion = "\n" + insertion + "\n"
	}
	result := text[:pos] + insertion + text[pos:]
	if _, errors := ParseConfigFileTextToJson(name, tspath.PathKey(name), result); len(errors) != 0 {
		return text, false
	}
	return result, true
}
