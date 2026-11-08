package tsoptions

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
