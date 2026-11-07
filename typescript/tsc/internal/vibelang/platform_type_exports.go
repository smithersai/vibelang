package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var platformTypeExportDiagnostic = EK4402.With("This export keeps a runtime load of {0}; write export type for type bindings, or move the export to a .ts file.")

func init() { fileChecks = append(fileChecks, checkPlatformTypeExports) }

func checkPlatformTypeExports(c *checker.Checker, file *ast.SourceFile) {
	findPlatformTypeExports(c, file, func(at *ast.Node, rewrite *formRewrite, args ...any) {
		d := report(c, at, platformTypeExportDiagnostic, args...)
		if rewrite.fixable() {
			note(d, "Its quick fix keeps the runtime dependency in a native module and retains the type exports; vibelang --fix applies it.")
		} else if rewrite != nil && rewrite.why != "" {
			note(d, rewrite.why)
		}
	})
}

func preservedPlatformTypeExport(c *checker.Checker, statement *ast.Node) bool {
	if !c.CompilerOptions().VerbatimModuleSyntax.IsTrue() || !ast.IsExportDeclaration(statement) {
		return false
	}
	declaration := statement.AsExportDeclaration()
	specifier, clause := declaration.ModuleSpecifier, declaration.ExportClause
	if declaration.IsTypeOnly || specifier == nil || !ast.IsStringLiteral(specifier) || clause == nil || !ast.IsNamedExports(clause) {
		return false
	}
	if _, platform := platformModuleOf(specifier.Text()); !platform {
		return false
	}
	for _, element := range clause.Elements() {
		if !ast.IsTypeOnlyImportOrExportDeclaration(element) {
			return false
		}
	}
	return true
}

func findPlatformTypeExports(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	for _, statement := range file.Statements.Nodes {
		if preservedPlatformTypeExport(c, statement) {
			report(statement.ModuleSpecifier(), platformTypeExportRewrite(c, file, statement), statement.ModuleSpecifier().Text())
		}
	}
}

// Keep the original runtime dependency at its import-order position. Merely
// adding export type would erase a load that verbatim TypeScript preserves.
// The native body has no captures or values and exposes no additional API.
func platformTypeExportRewrite(c *checker.Checker, file *ast.SourceFile, statement *ast.Node) *formRewrite {
	if !preservedPlatformTypeExport(c, statement) {
		return nil
	}
	declaration := statement.AsExportDeclaration()
	if declaration.Attributes != nil {
		return &formRewrite{why: "No quick fix: this export's attributes need a preserving TypeScript boundary."}
	}
	start := nodeStart(file, statement)
	leading := file.Text()[statement.Pos():start]
	// The inserted declaration would take the original export's leading
	// documentation or next-line tool directive. Leave those sites for an
	// explicit native boundary rather than reattach their metadata.
	for _, marker := range []string{"/**", "///", "@", "eslint-", "oxlint-", "biome-", "istanbul "} {
		if strings.Contains(leading, marker) {
			return &formRewrite{why: "No quick fix: retain this export's leading documentation and directives when moving its runtime dependency."}
		}
	}
	local := (&freshNames{file: file}).freshName("$platformExport" + strconv.Itoa(start))
	text := file.Text()
	specifier := nodeText(file, declaration.ModuleSpecifier)
	header := "module " + local + " {\n  export {} from " + specifier + "\n}\nimport " + local + ";\n"
	elements := declaration.ExportClause.Elements()
	if len(elements) == 0 {
		// With no bindings, keep the entire original statement and its comments
		// inside the TypeScript body.
		header = "module " + local + " {\n  " + text[start:statement.End()] + "\n}\nimport " + local + ";"
	} else {
		edits := []sourceEdit{{len("export"), len("export"), " type"}}
		for _, element := range elements {
			at := nodeStart(file, element)
			end := at + len("type")
			if end > len(text) || text[at:end] != "type" {
				return nil
			}
			for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
				end++
			}
			edits = append(edits, sourceEdit{at - start, end - start, ""})
		}
		header += applyEdits(text[start:statement.End()], edits)
	}
	return &formRewrite{description: "a native runtime dependency with type exports", edits: []sourceEdit{{start, statement.End(), header}}, message: platformTypeExportDiagnostic}
}

func findPlatformTypeLoads(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	findPlatformTypeImports(c, file, report)
	findPlatformTypeExports(c, file, report)
}

func platformTypeLoadRewrite(c *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
	if ast.IsStringLiteral(at) && at.Parent != nil && ast.IsExportDeclaration(at.Parent) {
		return platformTypeExportRewrite(c, file, at.Parent)
	}
	return platformTypeImportRewrite(c, file, at)
}

func platformTypeLoadDiagnosticNode(node *ast.Node) bool {
	return ast.IsImportDeclaration(node) || (ast.IsStringLiteral(node) && node.Parent != nil && ast.IsExportDeclaration(node.Parent) && node.Parent.ModuleSpecifier() == node)
}
