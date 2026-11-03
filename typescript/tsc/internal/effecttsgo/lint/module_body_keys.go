package lint

import (
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/keybuilder"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rule"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/typeparser"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
	tsdiag "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/scanner"
)

// deterministicKeys derives a key from the name of the file that declares the
// class. A module declaration's body (VIP-40) is a file of its own,
// a.vibe.platform.ts beside a.vibe, so the rule asked a service that kept its
// key across the move from a.ts for @x/pkg/a.vibe.platform/Port instead of
// @x/pkg/a/Port. The key is a run-time service identity and the published API,
// and the spec says moving a body to a sibling .ts file changes no diagnostic,
// so on a body the key comes from the .vibe file that holds it
// (platform-body:deterministicKeys-virtual-path, t3code desktop).
func init() {
	for i := range rules.All {
		if r := &rules.All[i]; r.Name == "deterministicKeys" {
			run := r.Run
			r.Run = func(ctx *rule.Context) []*ast.Diagnostic {
				module := ctx.SourceFile.EmbeddedModule()
				if module == nil || ctx.Options == nil {
					return run(ctx)
				}
				return moduleBodyKeys(ctx, ast.GetSourceFileOfNode(module.Declaration))
			}
		}
	}
}

// moduleBodyKeys reports, on a module declaration's body, each key that is not
// the deterministic key of its class in host, the .vibe file.
func moduleBodyKeys(ctx *rule.Context, host *ast.SourceFile) []*ast.Diagnostic {
	type keyed struct {
		name, key *ast.Node
		target    string
	}
	var classes []keyed
	seen := map[*ast.Node]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindClassDeclaration && node.Name() != nil {
			if name, key, target := keyedClass(ctx.TypeParser, node); key != nil && name != nil {
				classes = append(classes, keyed{name, key, target})
				seen[key] = true
			}
		}
		node.ForEachChild(visit)
		return false
	}
	ctx.SourceFile.AsNode().ForEachChild(visit)
	// extendedKeyDetection's custom keys: the rule's own analysis finds them
	// (a parameter's @effect-identifier tag); it misses only a custom key that
	// already equals the body file's key.
	for _, m := range rules.AnalyzeDeterministicKeys(ctx.TypeParser, ctx.Program, ctx.Checker, ctx.SourceFile, ctx.Options) {
		if seen[m.KeyStringLiteral] {
			continue
		}
		class := m.KeyStringLiteral
		for class != nil && class.Kind != ast.KindClassDeclaration {
			class = class.Parent
		}
		if class != nil && class.Name() != nil {
			classes = append(classes, keyed{class.Name(), m.KeyStringLiteral, "custom"})
		}
	}
	var diags []*ast.Diagnostic
	for _, k := range classes {
		expected := keybuilder.CreateStringForSourceFile(ctx.Program, ctx.TypeParser, host, scanner.GetTextOfNode(k.name), k.target, ctx.Options.GetKeyPatterns())
		if expected == "" || k.key.AsStringLiteral().Text == expected {
			continue
		}
		diags = append(diags, ctx.NewDiagnostic(ctx.SourceFile, scanner.GetErrorRangeForNode(ctx.SourceFile, k.key), tsdiag.This_key_does_not_match_the_deterministic_key_for_this_declaration_The_expected_key_is_0_effect_deterministicKeys, nil, expected))
	}
	return diags
}

type keyedResult interface {
	ClassName() *ast.Node
	KeyStringLiteral() *ast.Node
}

// keyedClass matches class as the rule does (matchClassPattern), service
// targets first, then error targets.
func keyedClass(tp *typeparser.TypeParser, class *ast.Node) (name, key *ast.Node, target string) {
	if r := tp.ExtendsEffectV3Service(class); r != nil {
		return keyedOf(r, "service")
	}
	if r := tp.ExtendsContextTag(class); r != nil {
		return keyedOf(r, "service")
	}
	if r := tp.ExtendsEffectTag(class); r != nil {
		return keyedOf(r, "service")
	}
	if r := tp.ExtendsContextService(class); r != nil {
		return keyedOf(r, "service")
	}
	if r := tp.ExtendsDataTaggedError(class); r != nil {
		return keyedOf(r, "error")
	}
	if r := tp.ExtendsSchemaTaggedError(class); r != nil {
		return keyedOf(r, "error")
	}
	return nil, nil, ""
}

func keyedOf(r keyedResult, target string) (*ast.Node, *ast.Node, string) {
	return r.ClassName(), r.KeyStringLiteral(), target
}
