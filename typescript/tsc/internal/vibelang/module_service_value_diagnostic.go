package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterDiagnosticsFilterHook(explainModuleServiceValue) }

// A module assigned to a variable stays a module (D311). Keep TS2339 and its
// location, but explain a service member that the module's same-named export
// carries. No receiver, property resolution, or accepted program changes.
func explainModuleServiceValue(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || d.Code() != 2339 || diagnosticAlreadyExplained(c, file, d) {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || name.Parent == nil || !ast.IsPropertyAccessExpression(name.Parent) || inHatch(name) {
			continue
		}
		access := name.Parent
		receiver := c.GetApparentType(c.GetTypeAtLocation(access.Expression()))
		module := receiver.Symbol()
		if module == nil || module.Flags()&ast.SymbolFlagsValueModule == 0 {
			continue
		}
		moduleName := path.Base(strings.Trim(module.Name(), "\""))
		key := moduleServiceKeyOf(c, module, moduleName)
		if key == nil {
			continue
		}
		_, shape := serviceOfKey(c, c.GetTypeOfSymbol(key))
		if shape == nil || c.GetPropertyOfType(shape, name.Text()) == nil {
			continue
		}
		spelling := moduleServiceValueSpelling(c, file, access, module, moduleName)
		if spelling == "" {
			continue
		}
		replacement := d.Clone()
		memberType := c.GetTypeOfPropertyOfType(shape, name.Text())
		if isEffectValueType(c, memberType) || len(c.GetSignaturesOfType(memberType, checker.SignatureKindCall)) != 0 {
			note(replacement, "Write {0}() to read the service implementation, or call {0}.{1}(...) directly.", spelling, name.Text())
		} else {
			note(replacement, "Write {0}() to read the service implementation, then read its {1} member.", spelling, name.Text())
		}
		if isAtModuleTopLevel(access) {
			note(replacement, "Move the implementation lookup into an Effect function; a module's top level cannot run it.")
		}
		all[i] = replacement
	}
	return all
}

// Suggest only a spelling that reaches this module at the error site, so a
// local declaration shadowing FileSystem or Experimental gets no wrong hint.
func moduleServiceValueSpelling(c *checker.Checker, file *ast.SourceFile, at *ast.Node, module *ast.Symbol, name string) string {
	sameModule := func(symbol *ast.Symbol) bool { return symbol != nil && c.SkipAlias(symbol) == module }
	visible := c.ResolveName(name, at, ast.SymbolFlagsValue, false /*excludeGlobals*/)
	if sameModule(visible) && (isEffectImport(visible) || visible == preludeSymbol(c, preludeStateOf(c), file, name)) {
		return name
	}
	namespace := c.ResolveName("Experimental", at, ast.SymbolFlagsValue, false /*excludeGlobals*/)
	if namespace != nil && namespace == preludeSymbol(c, preludeStateOf(c), file, "Experimental") {
		if sameModule(c.TryGetMemberInModuleExports(name, c.SkipAlias(namespace))) {
			return "Experimental." + name
		}
	}
	return ""
}
