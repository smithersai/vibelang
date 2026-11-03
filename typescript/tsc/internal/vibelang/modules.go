package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Module declarations (D283).
//
//	module text {
//	  export function clean(value: string): string { return value.trim() }
//	}
//	import { clean } from text
//
// The parser gives each module declaration's body a TypeScript source file
// of its own, beside the .vibe file and with its positions
// (parser/vibelang_modules.go), and the program resolves `from text` to it.
// The body is therefore checked as any .ts file is, and the .vibe file sees
// it only through its imports.
//
// Each body the file imports is a JavaScript module of its own (D403),
// main.vibe.text.js beside main.js, which main.js imports where the source
// wrote `from text`:
//
//	import { clean } from "./main.vibe.text.js"
//
// so ECMAScript orders its evaluation among the file's imports and keeps its
// exports live bindings (D364). A module that the file never imports, or
// imports only types from, emits no JavaScript, as TypeScript elides such an
// import of a .ts file (moduleEmitsScript). The module's declarations are its
// own declaration file, main.vibe.text.d.ts, which the .vibe file's
// declarations import as ./main.vibe.text.js.

func init() {
	fileChecks = append(fileChecks, checkModuleDeclarations)
	typeScriptFileChecks = append(typeScriptFileChecks, checkModuleBody)
	compiler.RegisterEmbeddedModuleScriptHook(moduleEmitsScript)
}

// checkModuleDeclarations reports misplaced and misspelled module
// declarations (VIP-40) and module specifiers that name no declaration.
func checkModuleDeclarations(c *checker.Checker, file *ast.SourceFile) {
	seen := map[string]bool{}
	moduleNames := map[string]bool{}
	for _, body := range file.SupplementalSourceFiles() {
		if module := body.EmbeddedModule(); module != nil {
			moduleNames[module.Name] = true
		}
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case parser.IsVibeLangModuleDeclaration(node):
			// TypeScript's own checks read the node as a namespace declared with module.
			cover(c, node)
			name := node.Name().Text()
			if name == "" {
				// module { }: the name's place, after the keyword, is empty.
				keyword := core.NewTextRange(node.Name().Pos()-len("module"), node.Name().Pos())
				reportAt(c, file, keyword, EK4003)
				return false
			}
			key := strings.ToLower(name)
			switch {
			case node.Parent != file.AsNode():
				report(c, node.Name(), EK4001)
			case node.Modifiers() != nil && len(node.Modifiers().Nodes) != 0:
				report(c, node.Modifiers().Nodes[0], EK4002, name)
			case seen[key]:
				report(c, node.Name(), EK4408.With("This file already declares a module named {0}."), name)
			}
			seen[key] = true
			if symbol := c.ResolveName(name, node, ast.SymbolFlagsValue, true); symbol != nil &&
				c.GetSymbolFlags(symbol)&ast.SymbolFlagsValue != 0 && c.GetTypeOnlyAliasDeclaration(symbol) == nil {
				// Unused modules with a colliding value already run correctly. Report
				// the collision without rejecting those programs (D303).
				collision := EK4408.With("A module named {0} shares its name with a value binding of this file; use a distinct module name.")
				collision.Category = warningCategory
				report(c, node.Name(), collision, name)
			}
			return false
		case parser.IsVibeLangModuleReference(node):
			if moduleReferenceHasAttributes(node) {
				coverCodes(c, node.Parent, 2856, 2823, 2857)
				report(c, node, EK4006.With("An identifier module specifier cannot carry import attributes. Use a string specifier for a file or package."))
			} else if file.EmbeddedModuleBySpecifier(node.Text()) == nil {
				cover(c, node)
				report(c, node, EK4006, specifierName(file, node))
			}
			return false
		case ast.IsIdentifier(node) && moduleNames[node.Text()] && (!ast.IsDeclarationName(node) || ast.IsShorthandPropertyAssignment(node.Parent)) && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(node) && (!ast.IsPartOfTypeNode(node) || ast.IsPartOfTypeQuery(node)):
			symbol := c.ResolveName(node.Text(), node, ast.SymbolFlagsValue|ast.SymbolFlagsNamespaceModule, false)
			if symbol != nil && c.GetSymbolFlags(symbol)&ast.SymbolFlagsValue == 0 {
				for _, declaration := range symbol.Declarations() {
					if parser.IsVibeLangModuleDeclaration(declaration) {
						coverCodes(c, node, 2708)
						report(c, node, EK4004, node.Text())
						break
					}
				}
			}
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
}

// specifierName returns the identifier a module reference was written as.
func specifierName(file *ast.SourceFile, reference *ast.Node) string {
	return file.Text()[scanner.SkipTrivia(file.Text(), reference.Pos()):reference.End()]
}

// checkModuleBody reports what a module declaration's body cannot hold
// (EK4008): it is an ES module under every emit target (VIP-40).
func checkModuleBody(c *checker.Checker, file *ast.SourceFile) {
	if file.EmbeddedModule() == nil {
		return
	}
	for _, statement := range file.Statements.Nodes {
		var text string
		switch {
		case ast.IsExportAssignment(statement) && statement.AsExportAssignment().IsExportEquals:
			text = "A module declaration's body is an ES module, which export = cannot end; use export default."
		case ast.IsImportEqualsDeclaration(statement) && ast.IsExternalModuleReference(statement.AsImportEqualsDeclaration().ModuleReference):
			text = "A module declaration's body is an ES module, which imports with import, not import = require()."
		default:
			continue
		}
		// VIP-40 profile errors belong to the containing .vibe file under any emit.
		coverCodes(c, statement, 1202, 1203)
		c.AddDiagnostic(ast.NewExternalDiagnostic(file, scanner.GetErrorRangeForNode(file, statement), diagnosticSource, errorCategory, EK4008.Code, text))
	}
}

// moduleEmitsScript reports whether module, a module declaration's body,
// emits JavaScript (D403): whether the JavaScript of its .vibe file keeps an
// import or re-export of it, by TypeScript's import elision. An import for
// its effects, `import text`, and `export * from text` always stay.
func moduleEmitsScript(resolver printer.EmitResolver, options *core.CompilerOptions, module *ast.SourceFile) bool {
	file := module.CanonicalSourceFile()
	if file == nil {
		return true
	}
	resolver.MarkLinkedReferencesRecursively(file)
	verbatim := options.VerbatimModuleSyntax.IsTrue()
	keepsImport := func(declaration *ast.Node) bool {
		return !declaration.IsTypeOnly() && (verbatim || resolver.IsReferencedAliasDeclaration(declaration))
	}
	keepsExport := func(declaration *ast.Node) bool {
		return !declaration.IsTypeOnly() && (verbatim || resolver.IsValueAliasDeclaration(declaration))
	}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) && !ast.IsExportDeclaration(statement) {
			continue
		}
		specifier := statement.ModuleSpecifier()
		if specifier == nil || !parser.IsVibeLangModuleReference(specifier) || specifier.Text() != module.EmbeddedModule().Specifier {
			continue
		}
		switch {
		case ast.IsImportDeclaration(statement):
			clause := statement.AsImportDeclaration().ImportClause
			if clause == nil {
				return true // import text
			}
			if clause.IsTypeOnly() {
				continue
			}
			if clause.Name() != nil && keepsImport(clause) {
				return true
			}
			if bindings := clause.AsImportClause().NamedBindings; bindings != nil {
				if bindings.Kind == ast.KindNamespaceImport {
					if keepsImport(bindings) {
						return true
					}
				} else if core.Some(bindings.Elements(), keepsImport) {
					return true
				}
			}
		case ast.IsExportDeclaration(statement):
			d := statement.AsExportDeclaration()
			switch {
			case d.IsTypeOnly:
			case d.ExportClause == nil || d.ExportClause.Kind == ast.KindNamespaceExport:
				return true // export * from text, export * as text from text
			case core.Some(d.ExportClause.Elements(), keepsExport):
				return true
			}
		}
	}
	return false
}

// moduleExportNameText is the text of a module export name.
func moduleExportNameText(name *ast.Node) string {
	return name.Text()
}

func moduleReferenceHasAttributes(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindImportDeclaration:
		return parent.AsImportDeclaration().Attributes != nil
	case ast.KindExportDeclaration:
		return parent.AsExportDeclaration().Attributes != nil
	}
	return false
}
