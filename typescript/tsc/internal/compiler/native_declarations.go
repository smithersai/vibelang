package compiler

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Native declarations. Stock TypeScript maps a written ./x.js, ./x.jsx, ./x
// or ./x.ts only to x.ts, x.tsx or x.d.ts; it never reaches the
// compatibility declaration x.d.vibe.ts that way. Each .vibe or .vibex
// module therefore also gets x.d.ts beside its sidecar, which re-exports the
// sidecar:
//
//	export * from "./x.vibe";
//	export { default } from "./x.vibe";
//
// The second line is present only when the module has a default export. A
// declaration whose module is assigned with export = is re-exported as
//
//	import vibe = require("./x.vibe");
//	export = vibe;
//
// which TypeScript allows in a declaration file under any module setting.
// Re-exporting, rather than copying the sidecar, keeps one module identity:
// a class with a private member, a unique symbol or a global augmentation
// declared once, whichever spelling an importer uses. Like the sidecar it is
// an emit output, and a file at its path that is not such a re-export is
// never overwritten.

// NativeDeclarationPath returns the native declaration that goes beside the
// compatibility declaration sidecar: x.d.ts for x.d.vibe.ts or x.d.vibex.ts,
// or "" for any other file.
func NativeDeclarationPath(sidecar string) string {
	for _, extension := range []string{tspath.ExtensionVibex, tspath.ExtensionVibe} {
		if stem, ok := strings.CutSuffix(sidecar, ".d"+extension+".ts"); ok {
			return stem + tspath.ExtensionDts
		}
	}
	return ""
}

// nativeDeclarationSpecifier is the sidecar's name in its native
// declaration, relative to their shared directory: ./x.vibe or ./x.vibex.
func nativeDeclarationSpecifier(source string) string {
	return "./" + tspath.GetBaseFileName(source)
}

// NativeDeclarationText returns the native declaration of a module whose
// sidecar, named specifier, has the declaration text sidecar.
func NativeDeclarationText(specifier string, sidecar string) string {
	hasDefault, exportEquals := declarationExports(sidecar)
	if exportEquals {
		return "import vibe = require(\"" + specifier + "\");\nexport = vibe;\n"
	}
	text := "export * from \"" + specifier + "\";\n"
	if hasDefault {
		text += "export { default } from \"" + specifier + "\";\n"
	}
	return text
}

// nativeDeclarationYields reports whether a module gets no native declaration
// because a sibling already answers stock TypeScript's lookups: x.ts or
// x.tsx, which both checkers select for ./x.js, or the other VibeLang
// source, so that x.vibe and x.vibex never share one x.d.ts.
func (p *Program) nativeDeclarationYields(source string) bool {
	extension := tspath.VibeLangSourceExtension(source)
	stem := strings.TrimSuffix(source, extension)
	other := tspath.ExtensionVibex
	if extension == tspath.ExtensionVibex {
		other = tspath.ExtensionVibe
	}
	fs := p.Host().FS()
	for _, sibling := range []string{tspath.ExtensionTs, tspath.ExtensionTsx, other} {
		if fs.FileExists(tspath.RootedFilePathFromNormalized(stem + sibling)) {
			return true
		}
	}
	return false
}

// nativeDeclarationTarget returns the path of a module's native declaration
// when compatibility emit writes one: not when a sibling answers the lookups
// or the project's own declaration output is written there.
func (p *Program) nativeDeclarationTarget(file *ast.SourceFile) (string, bool) {
	source := string(file.FileName())
	sidecar, _ := p.vibeSidecarPaths(source)
	native := NativeDeclarationPath(sidecar)
	if native == "" || p.nativeDeclarationYields(source) || p.emitsDeclarationAt(file, native) {
		return native, false
	}
	return native, true
}

// isNativeDeclarationText reports whether text is a native declaration of
// the sidecar named specifier, which emit may replace or remove: only
// re-exports of that sidecar, as nativeDeclarationText writes them.
func isNativeDeclarationText(text string, specifier string) bool {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: "/native.d.ts",
		PathKey:  "/native.d.ts",
	}, text, core.ScriptKindTS)
	statements := file.Statements.Nodes
	if len(statements) == 0 || len(file.Diagnostics()) != 0 {
		return false
	}
	// The export = form: an import of the sidecar and its assignment.
	if len(statements) == 2 && ast.IsImportEqualsDeclaration(statements[0]) && ast.IsExportAssignment(statements[1]) {
		imported := statements[0].AsImportEqualsDeclaration()
		assignment := statements[1].AsExportAssignment()
		reference := imported.ModuleReference
		return !imported.IsTypeOnly && reference != nil && ast.IsExternalModuleReference(reference) &&
			ast.IsStringLiteral(reference.AsExternalModuleReference().Expression) && reference.AsExternalModuleReference().Expression.Text() == specifier &&
			assignment.IsExportEquals && ast.IsIdentifier(assignment.Expression) && assignment.Expression.Text() == imported.Name().Text()
	}
	for _, statement := range statements {
		if !ast.IsExportDeclaration(statement) {
			return false
		}
		declaration := statement.AsExportDeclaration()
		if declaration.IsTypeOnly || declaration.ModuleSpecifier == nil || !ast.IsStringLiteral(declaration.ModuleSpecifier) || declaration.ModuleSpecifier.Text() != specifier {
			return false
		}
		if clause := declaration.ExportClause; clause != nil {
			if !ast.IsNamedExports(clause) {
				return false
			}
			for _, element := range clause.AsNamedExports().Elements.Nodes {
				specifier := element.AsExportSpecifier()
				if specifier.PropertyName != nil || element.Name().Text() != "default" {
					return false
				}
			}
		}
	}
	return true
}

// declarationExports reports whether declaration text exports a default
// (export default, an export with the default modifier, or a named export
// called default) and whether it assigns its module with export =.
func declarationExports(text string) (hasDefault bool, exportEquals bool) {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: "/sidecar.d.ts",
		PathKey:  "/sidecar.d.ts",
	}, text, core.ScriptKindTS)
	for _, statement := range file.Statements.Nodes {
		switch {
		case ast.IsExportAssignment(statement):
			if statement.AsExportAssignment().IsExportEquals {
				exportEquals = true
			} else {
				hasDefault = true
			}
		case ast.IsExportDeclaration(statement):
			if clause := statement.AsExportDeclaration().ExportClause; clause != nil && ast.IsNamedExports(clause) {
				for _, element := range clause.AsNamedExports().Elements.Nodes {
					if element.Name().Text() == "default" {
						hasDefault = true
					}
				}
			}
		default:
			if ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) && ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) {
				hasDefault = true
			}
		}
	}
	return hasDefault, exportEquals
}

// isOwnNativeDeclaration reports whether the file at native is the native
// declaration emit writes for source.
func (p *Program) isOwnNativeDeclaration(source *ast.SourceFile, native string) bool {
	existing, ok := p.Host().FS().ReadFile(tspath.RootedFilePathFromNormalized(native))
	return ok && isNativeDeclarationText(existing, nativeDeclarationSpecifier(string(source.FileName())))
}
