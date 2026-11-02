package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var EK4503 = message(4503, errorCategory, "{0} belongs to the service implementation; read it with {1}().{2}.")

func init() {
	registry[EK4503.Code] = EK4503
	checker.RegisterDiagnosticsFilterHook(explainServiceValue)
	fileChecks = append(fileChecks, checkShadowedServiceValues)
}

// Only replace a missing-member error. Static key members, and S.method()
// calls whose receiver hook already supplies the implementation, are valid.
// A module whose name names a service (D311) reads the same way as its key:
// Path.sep is Path.Path.sep, so it is EK4503 too, and Path().sep reads it.
func explainServiceValue(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || d.Code() != 2339 || diagnosticAlreadyExplained(c, file, d) {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || name.Parent == nil || !ast.IsPropertyAccessExpression(name.Parent) {
			continue
		}
		access := name.Parent
		if inHatch(access) {
			continue
		}
		receiver := c.GetTypeAtLocation(access.Expression())
		_, shape := serviceOfKey(c, c.GetApparentType(receiver))
		if shape == nil {
			if key := moduleServiceKey(c, access.Expression(), receiver); key != nil {
				_, shape = serviceOfKey(c, c.GetTypeOfSymbol(key))
			}
		}
		if shape == nil || c.GetPropertyOfType(shape, name.Text()) == nil {
			continue
		}
		replacement := newDiagnosticAt(optionsFor(c, file), file, d.Loc(), EK4503,
			nodeText(file, access), nodeText(file, access.Expression()), name.Text())
		if isAtModuleTopLevel(access) {
			note(replacement, "Move the implementation lookup into an Effect function; a module's top level cannot run it.")
		}
		noteServiceMethod(c, file, access, shape, replacement)
		all[i] = replacement
	}
	return all
}

// checkShadowedServiceValues reports EK4503 where a .vibe function body reads
// a member that the service declares through its key, and the key has a
// member of the same name: name, length and prototype as a class, call and
// toString from Function, hasOwnProperty from Object, key and pipe as an
// Effect Context key. TypeScript resolves such a read to the key's member, so
// no TS2339 reaches explainServiceValue, and the program would silently read
// the key's member. The service's member wins (D41), as it does in a call.
// Outside function bodies the member rules do not apply (D90), and the read
// keeps its TypeScript meaning. Types are skipped: checking a type's
// property access, such as a local schema's Schema.Schema.Type, as a value
// would report an error that TypeScript does not.
func checkShadowedServiceValues(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsPartOfTypeNode(node) {
			return false
		}
		if ast.IsPropertyAccessExpression(node) && !ast.IsPrivateIdentifier(node.Name()) && !isMemberCallSite(node) && !isClauseOperation(node) && inLowerableBody(node) {
			receiver := c.GetApparentType(c.GetTypeAtLocation(node.Expression()))
			name := node.Name().Text()
			if _, shape := serviceMember(c, node, receiver); shape != nil && c.GetPropertyOfType(receiver, name) != nil {
				d := report(c, node.Name(), EK4503, nodeText(file, node), nodeText(file, node.Expression()), name)
				noteServiceMethod(c, file, node, shape, d)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// noteServiceMethod tells d, EK4503 at access, how to extract or call the
// member when the service declares it as a method.
func noteServiceMethod(c *checker.Checker, file *ast.SourceFile, access *ast.Node, shape *checker.Type, d *ast.Diagnostic) {
	name := access.Name().Text()
	member := c.GetTypeOfPropertyOfType(shape, name)
	if len(c.GetSignaturesOfType(member, checker.SignatureKindCall)) != 0 {
		note(d, "To extract the implementation method, write {0}().{1}; to call it directly, write {0}.{1}(…).",
			nodeText(file, access.Expression()), name)
	} else if effectOfValue(c, member) != nil {
		// Terminal.columns: the member is itself a program, as Effect
		// declares it, so reading it gives the program and a call runs it.
		note(d, "{0}().{1} is a program, as the service declares it; {0}.{1}() runs it.",
			nodeText(file, access.Expression()), name)
	}
}
