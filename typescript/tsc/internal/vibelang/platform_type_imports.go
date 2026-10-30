package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

var platformTypeImportDiagnostic = EK4402.With("This import keeps a runtime load of {0}; write import type for type bindings, or move the import to a .ts file.")

func init() {
	fileChecks = append(fileChecks, checkPlatformTypeImports)
	// Reuse the source-edit, comment-preserving editor/CLI fix machinery,
	// without replacing EK4402's general platform message in the registry.
	tsFormFixCodes = append(tsFormFixCodes, EK4402.Code)
	tsFormRules[EK4402.Code] = &tsFormRule{
		message:   platformTypeImportDiagnostic,
		find:      findPlatformTypeImports,
		plan:      platformTypeImportRewrite,
		diagnosed: ast.IsImportDeclaration,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

func checkPlatformTypeImports(c *checker.Checker, file *ast.SourceFile) {
	findPlatformTypeImports(c, file, func(at *ast.Node, rewrite *formRewrite, args ...any) {
		d := reportAt(c, file, tsFormSpan(file, at), platformTypeImportDiagnostic, args...)
		if rewrite.fixable() {
			note(d, "Its quick fix writes import type; vibelang --fix applies it.")
		} else if rewrite != nil && rewrite.why != "" {
			note(d, rewrite.why)
		}
	})
}

func findPlatformTypeImports(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	for _, statement := range file.Statements.Nodes {
		if preservedPlatformTypeImport(c, statement) {
			report(statement, platformTypeImportRewrite(c, file, statement), statement.ModuleSpecifier().Text())
		}
	}
}

// TypeScript preserves even import {} and import { type T } under verbatim
// syntax. With elision enabled they disappear; import type always disappears.
func preservedPlatformTypeImport(c *checker.Checker, statement *ast.Node) bool {
	if !c.CompilerOptions().VerbatimModuleSyntax.IsTrue() || !ast.IsImportDeclaration(statement) {
		return false
	}
	specifier, clause := statement.ModuleSpecifier(), statement.ImportClause()
	if specifier == nil || !ast.IsStringLiteral(specifier) || clause == nil || clause.IsTypeOnly() || clause.Name() != nil {
		return false
	}
	if _, platform := platformModuleOf(specifier.Text()); !platform {
		return false
	}
	named := clause.AsImportClause().NamedBindings
	if named == nil || !ast.IsNamedImports(named) {
		return false
	}
	for _, element := range named.Elements() {
		if !element.AsImportSpecifier().IsTypeOnly {
			return false // existing checks diagnose its value bindings
		}
	}
	return true
}

func platformTypeImportRewrite(c *checker.Checker, file *ast.SourceFile, statement *ast.Node) *formRewrite {
	if !preservedPlatformTypeImport(c, statement) {
		return nil
	}
	clause := statement.ImportClause().AsImportClause()
	if len(clause.NamedBindings.Elements()) == 0 {
		return &formRewrite{why: "This import has no type bindings to rewrite; move the runtime dependency to a .ts file."}
	}
	if statement.AsImportDeclaration().Attributes != nil || clause.PhaseModifier != ast.KindUnknown {
		return &formRewrite{why: "No quick fix: this import's attributes or phase need a preserving TypeScript boundary."}
	}
	text := file.Text()
	start := nodeStart(file, statement) + len("import")
	edits := []sourceEdit{{start, start, " type"}}
	for _, element := range clause.NamedBindings.Elements() {
		at := nodeStart(file, element)
		end := at + len("type")
		if end > len(text) || text[at:end] != "type" {
			return nil
		}
		// Keep comments and line breaks; remove only the keyword's following
		// horizontal whitespace so the surrounding import keeps its layout.
		for end < len(text) && (text[end] == ' ' || text[end] == 9) {
			end++
		}
		edits = append(edits, sourceEdit{at, end, ""})
	}
	return &formRewrite{description: "import type", edits: edits}
}
