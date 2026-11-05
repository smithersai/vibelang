package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A satisfies constraint is erased at runtime. Retain its structural check
// with a local foreign call signature that admits the original thrown type.
func callbackSatisfiesFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	ds := program.GetSemanticDiagnostics(ctx, file)
	for _, d := range ds {
		if d.Source() != diagnosticSource || d.Code() != EK0402.Code {
			continue
		}
		value := reportedNode(file, core.NewTextRange(d.Pos(), d.End()), func(n *ast.Node) bool {
			return ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) || ast.IsElementAccessExpression(n) || ast.IsSatisfiesExpression(n)
		})
		if value != nil {
			node := value
			for ast.IsParenthesizedExpression(node.Parent) {
				node = node.Parent
			}
			if parent := node.Parent; ast.IsSatisfiesExpression(parent) && parent.Expression() == node {
				operand := ast.SkipParentheses(parent.Expression())
				key := fmt.Sprintf("callback-satisfies:%d", nodeStart(file, parent))
				if !refused[key] && (ast.IsIdentifier(operand) || ast.IsPropertyAccessExpression(operand) || ast.IsElementAccessExpression(operand)) &&
					!hasComment(file.Text()[parent.Expression().End():parent.End()]) {
					constraint := parent.Type()
					for constraint.Kind == ast.KindParenthesizedType {
						constraint = constraint.Type()
					}
					if ast.IsFunctionTypeNode(constraint) && len(constraint.TypeParameters()) == 0 {
						if edits, ok := callbackMigrationTypeEdits(file, constraint); ok {
							p.fixes = append(p.fixes, fileFix{code: EK0402.Code, key: key, edits: edits, siteStart: d.Pos(), siteEnd: d.End(), sited: true})
							return p
						}
					}
				}
			}
		}
	}
	return p
}

// A TypeScript callback can throw. A private migrated callback parameter that
// receives a foreign thrower retains that contract in a VIP-40 type-only body.
// Bridge all its direct calls in the same proposal: changing the type alone
// would introduce EK0403 before the ordinary bridge pass can run.
func callbackMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	ds := program.GetSemanticDiagnostics(ctx, file)
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	seen := map[*ast.Node]bool{}
	for _, d := range ds {
		if d.Source() != diagnosticSource || d.Code() != EK0402.Code {
			continue
		}
		expr := reportedNode(file, core.NewTextRange(d.Pos(), d.End()), func(n *ast.Node) bool { return ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) })
		if expr == nil {
			continue
		}
		target := c.GetContextualType(expr, checker.ContextFlagsNone)
		if target == nil {
			continue
		}
		signatures := c.GetSignaturesOfType(target, checker.SignatureKindCall)
		if len(signatures) != 1 {
			continue
		}
		decl := signatures[0].Declaration()
		if decl == nil || !ast.IsFunctionTypeNode(decl) || ast.GetSourceFileOfNode(decl) != file || seen[decl] ||
			decl.Parent == nil || (!ast.IsParameterDeclaration(decl.Parent) && !ast.IsPropertySignatureDeclaration(decl.Parent)) || len(decl.TypeParameters()) > 0 ||
			isExportedStatementPart(decl) || hasComment(nodeText(file, decl)) {
			continue
		}
		seen[decl] = true
		key := fmt.Sprintf("callback-contract:%d", nodeStart(file, decl))
		if refused[key] {
			continue
		}
		edits, ok := callbackMigrationEdits(c, file, decl)
		if ok {
			p.fixes = append(p.fixes, fileFix{code: EK0402.Code, key: key, edits: edits, siteStart: d.Pos(), siteEnd: d.End(), sited: true})
			return p // reserve fresh module/type names before planning another callback
		}
	}
	return p
}

func callbackMigrationTypeEdits(file *ast.SourceFile, decl *ast.Node) ([]sourceEdit, bool) {
	start, end := nodeStart(file, decl), decl.End()
	module, alias := freshName(file, "$callback$ts"), freshName(file, "$Callback")
	typeBase := freshName(file, "$Type")
	var parameters, arguments []string
	var inside []sourceEdit
	bad := false
	var capture func(*ast.Node) bool
	capture = func(n *ast.Node) bool {
		if ast.IsInferTypeNode(n) || ast.IsTypePredicateNode(n) {
			bad = true
			return true
		}
		if ast.IsTypeReferenceNode(n) || ast.IsTypeQueryNode(n) || ast.IsImportTypeNode(n) {
			name := fmt.Sprintf("%s%d", typeBase, len(parameters))
			parameters = append(parameters, name)
			arguments = append(arguments, nodeText(file, n))
			inside = append(inside, sourceEdit{nodeStart(file, n), n.End(), name})
			return false
		}
		return n.ForEachChild(capture)
	}
	decl.ForEachChild(capture)
	if bad {
		return nil, false
	}
	lex := scanner.NewScanner()
	lex.SetText(file.Text()[decl.ParameterList().End():nodeStart(file, decl.Type())])
	arrow := -1
	for token := lex.Scan(); token != ast.KindEndOfFile; token = lex.Scan() {
		if token == ast.KindEqualsGreaterThanToken {
			arrow = decl.ParameterList().End() + lex.TokenStart()
			break
		}
	}
	if arrow < 0 {
		return nil, false
	}
	inside = append(inside, sourceEdit{arrow, arrow + 2, ":"})
	signature := applyEdits(file.Text()[:end], inside)[start:]
	typeParams, typeArgs := "", ""
	if len(parameters) > 0 {
		typeParams = "<" + strings.Join(parameters, ", ") + ">"
		typeArgs = "<" + strings.Join(arguments, ", ") + ">"
	}
	header := "\nmodule " + module + " {\nexport type Callback" + typeParams + " = {\n/** @throws {unknown} */\n" + signature + ";\n};\n}\nimport type { Callback as " + alias + " } from " + module + ";\n"
	edits := []sourceEdit{{start, end, alias + typeArgs}, {len(file.Text()), len(file.Text()), header}}
	return edits, true
}

func callbackMigrationEdits(c *checker.Checker, file *ast.SourceFile, decl *ast.Node) ([]sourceEdit, bool) {
	edits, ok := callbackMigrationTypeEdits(file, decl)
	if !ok {
		return nil, false
	}

	symbol := c.GetSymbolOfDeclaration(decl.Parent)
	if symbol == nil {
		return nil, false
	}
	bad := false
	calls := 0
	maps := map[*ast.Node]bool{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if !ast.IsCallExpression(n) {
			return n.ForEachChild(visit)
		}
		callee := n.Expression()
		called := n.Kind == ast.KindCallExpression && callee != nil && ast.IsIdentifier(callee) && c.GetSymbolAtLocation(callee) == symbol
		if n.Kind == ast.KindCallExpression && callee != nil && ast.IsPropertyAccessExpression(callee) {
			called = c.GetSymbolAtLocation(callee.Name()) == symbol
		}
		if called {
			if !inEffectCode(n) {
				var arrow *ast.Node
				for home := n.Parent; home != nil; home = home.Parent {
					if ast.IsFunctionLike(home) {
						arrow = home
						break
					}
				}
				if arrow == nil || !ast.IsArrowFunction(arrow) || arrow.Type() != nil || file.Text()[nodeStart(file, arrow)] != '(' {
					bad = true
					return true
				}
				parent := arrow.Parent
				for parent != nil && ast.IsParenthesizedExpression(parent) {
					parent = parent.Parent
				}
				if parent == nil || !ast.IsCallExpression(parent) || !isEffectFunction(c, parent.Expression(), "Effect", "map") || !ast.IsPropertyAccessExpression(parent.Expression()) {
					bad = true
					return true
				}
				if !maps[arrow] {
					maps[arrow] = true
					method := parent.Expression().Name()
					edits = append(edits, sourceEdit{nodeStart(file, method), method.End(), "flatMap"}, sourceEdit{nodeStart(file, arrow), nodeStart(file, arrow), "effect "})
				}
			}
			unsafe := false
			var operand func(*ast.Node) bool
			operand = func(x *ast.Node) bool {
				if isTry(x) || isEffectBlock(x) || ast.IsCallExpression(x) && ast.IsIdentifier(x.Expression()) && c.GetSymbolAtLocation(x.Expression()) == symbol {
					unsafe = true
					return true
				}
				return x.ForEachChild(operand)
			}
			for _, arg := range n.Arguments() {
				operand(arg)
			}
			if unsafe {
				bad = true
				return true
			}
			at := nodeStart(file, n)
			edits = append(edits, sourceEdit{at, at, "try Effect.orDie(Effect.try({ try: () => "}, sourceEdit{n.End(), n.End(), ", catch: (e) => e }))"})
			calls++
			return false
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return edits, !bad && calls > 0
}
