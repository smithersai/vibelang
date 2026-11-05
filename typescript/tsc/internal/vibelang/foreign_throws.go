package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// foreignThrowsContract reads the selected foreign signature, rather than a
// sibling overload. An annotation on a callable binding overrides its type's
// signature. A local alias preserves the foreign signature's contract (VIP-4).
// The written bit distinguishes @throws {never} from the foreign default.
func foreignThrowsContract(c *checker.Checker, call *ast.Node) (bound string, written bool) {
	decl := signatureDeclaration(c, call)
	if decl == nil {
		return "", false
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || isVibeLangFile(file) {
		return "", false
	}
	var candidates []*ast.Node
	if symbol := calleeSymbol(c, call); symbol != nil {
		for _, d := range symbol.Declarations() {
			if ast.IsVariableDeclaration(d) || ast.IsPropertyDeclaration(d) || d.Kind == ast.KindPropertySignature {
				candidates = append(candidates, d)
			}
		}
	}
	candidates = append(candidates, decl)
	for _, candidate := range candidates {
		source := ast.GetSourceFileOfNode(candidate)
		if source == nil || isVibeLangFile(source) || isLibFile(c, source) {
			continue
		}
		for _, host := range jsdocHosts(candidate) {
			// A tag belongs to the call signature, never to its type alias.
			if ast.IsTypeAliasDeclaration(host) {
				break
			}
			if !hasThrowsTag(host) {
				continue
			}
			var bounds []string
			for _, doc := range host.JSDoc(nil) {
				for _, tag := range jsdocTags(doc) {
					if !ast.IsJSDocThrowsTag(tag) {
						continue
					}
					expression := tag.AsJSDocThrowsTag().TypeExpression
					if expression == nil {
						bounds = append(bounds, "unknown")
						continue
					}
					t := expression.AsJSDocTypeExpression().Type
					if t == nil {
						bounds = append(bounds, "unknown")
						continue
					}
					if c.GetTypeFromTypeNode(t).Flags()&checker.TypeFlagsNever == 0 {
						bounds = append(bounds, strings.TrimSpace(nodeText(source, t)))
					}
				}
			}
			return strings.Join(bounds, " | "), true
		}
	}
	return "", false
}

var foreignThrowingCall = EK0403.With("'{0}' may throw '{1}'. Wrap the call with 'try Effect.try(() => …)'.")

// legacyForeignCallFailures is only for migration: the former emitter read
// all declarations of a callee before its selected signature, so an earlier
// overload could supply its failure classes. A preserving fix must retain
// that old channel split, even while the checker uses the selected contract.
// Intrinsic signatures retain the shipped classes the former emitter read.
func legacyForeignCallFailures(c *checker.Checker, call *ast.Node) []failure {
	decl := signatureDeclaration(c, call)
	if decl == nil || isParameterCall(c, call) || legacyListedInManifest(c, ast.GetSourceFileOfNode(decl)) {
		return nil
	}
	if isLibFile(c, ast.GetSourceFileOfNode(decl)) {
		return callTrust(c, call).failures
	}
	var candidates []*ast.Node
	if symbol := calleeSymbol(c, call); symbol != nil {
		candidates = append(candidates, symbol.Declarations()...)
	}
	candidates = append(candidates, decl)
	if symbol := decl.Symbol(); symbol != nil {
		candidates = append(candidates, symbol.Declarations()...)
	}
	failures := tagged(c, call, candidates, &trust{kind: trustForeign}).failures
	file := ast.GetSourceFileOfNode(call)
	if file == nil {
		return nil
	}
	for _, failure := range failures {
		if _, _, ok := reachClass(c, file, failure); !ok {
			// The former emitter skipped the entire implicit bridge if any
			// listed class was unreachable, so all exceptions stayed defects.
			return nil
		}
	}
	return failures
}

// needsExplicitThrowsBridge identifies contracts whose former implicit
// bridge must keep listed failures separate from unexpected defects.
func needsExplicitThrowsBridge(c *checker.Checker, call *ast.Node) bool {
	t := callTrust(c, call)
	if t.kind == trustBuiltin && len(t.failures) > 0 {
		return true
	}
	bound, written := foreignThrowsContract(c, call)
	return written && bound != ""
}
