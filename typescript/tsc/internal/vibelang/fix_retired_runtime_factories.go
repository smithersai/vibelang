package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// retiredRuntimeFactoryTitle names the fix; --fix admits it for the import
// codes the data-helper import fix otherwise owns (fileFixes).
const retiredRuntimeFactoryTitle = "Replace retired runtime factory calls with cold native Effect values"

func init() {
	for _, code := range []int32{2305, 2339, 2724} {
		nativeFixCodes = append(nativeFixCodes, code)
		vipMigrationFixCodes = append(vipMigrationFixCodes, code)
		tsFormFixCodes = append(tsFormFixCodes, code)
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2305, 2339, 2724}, GetCodeActions: retiredRuntimeFactoryActions})
}

// VIP-33 retires the runtime wrappers; VIP-34 preserves the old factories when
// migrating their explicit imports. Restrict the rewrite to direct calls of a
// proven runtime binding: escaping functions, type observations and dynamic
// namespace reads can observe identity or a declaration spelling we cannot keep.
func retiredRuntimeFactoryActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	file := fix.SourceFile
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	for _, binding := range importBindingsOf(file) {
		statement := binding.declaration
		module := statement.ModuleSpecifier()
		if module == nil || !ast.IsStringLiteral(module) || module.Text() != "vibelang-runtime" {
			continue
		}
		clause := statement.ImportClause().AsImportClause()
		if clause.IsTypeOnly() || clause.PhaseModifier == ast.KindDeferKeyword || clause.PhaseModifier == ast.KindSourceKeyword {
			continue
		}
		target := resolvedModuleFile(c, file, module.Text())
		if target == nil || packageNameOf(c, target) != "vibelang-runtime" {
			continue
		}
		namespace := ast.IsNamespaceImport(binding.node)
		imported := ""
		if ast.IsImportSpecifier(binding.node) {
			spec := binding.node.AsImportSpecifier()
			if spec.IsTypeOnly {
				continue
			}
			imported = binding.name
			if spec.PropertyName != nil {
				imported = spec.PropertyName.Text()
			}
			if imported != "interrupt" && imported != "yieldNow" {
				continue
			}
			if nodeStart(file, binding.node) > fix.Span.Pos() || binding.node.End() < fix.Span.End() {
				continue
			}
		} else if !namespace {
			continue
		}
		// The retired export no longer exists, so the import is an alias of
		// nothing: take the binder's alias symbol, which name resolution at
		// each use returns without following it.
		symbol := binding.node.Symbol()
		if symbol == nil {
			symbol = c.GetSymbolAtLocation(binding.node.Name())
		}
		if symbol == nil {
			continue
		}
		type site struct {
			call, callee *ast.Node
			name         string
		}
		var sites []site
		unsafe, keepNamespace, ownsDiagnostic := false, false, !namespace
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsImportDeclaration(n) {
				return false
			}
			// A direct eval can observe the import binding even when it is absent
			// from the static reference set. Leave such files for an explicit edit.
			if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "eval" {
				unsafe = true
			}
			if ast.IsIdentifier(n) && n.Text() == binding.name {
				parent := n.Parent
				referenced := c.GetSymbolAtLocation(n) == symbol || c.ResolveName(binding.name, n, ast.SymbolFlagsValue|ast.SymbolFlagsAlias, false) == symbol
				if parent != nil && ast.IsShorthandPropertyAssignment(parent) && parent.Name() == n {
					referenced = c.GetShorthandAssignmentValueSymbol(parent) == symbol
				}
				if parent != nil && ast.IsExportSpecifier(parent) {
					referenced = referenced || c.GetExportSpecifierLocalTargetSymbol(parent) == symbol
				}
				if referenced {
					if inTypeNode(n) {
						unsafe = true
						return false
					}
					callee, name := n, imported
					if namespace {
						if parent == nil || !ast.IsPropertyAccessExpression(parent) || parent.Expression() != n || ast.IsPrivateIdentifier(parent.Name()) {
							unsafe = true
							return false
						}
						callee, name = parent, parent.Name().Text()
						if name != "interrupt" && name != "yieldNow" {
							keepNamespace = true
							return false
						}
					}
					wrapped := callee
					for wrapped.Parent != nil && ast.IsParenthesizedExpression(wrapped.Parent) {
						wrapped = wrapped.Parent
					}
					call := wrapped.Parent
					if call == nil || !ast.IsCallExpression(call) || call.Expression() != wrapped || call.TypeArguments() != nil || len(call.Arguments()) > 1 || name == "interrupt" && len(call.Arguments()) != 0 {
						unsafe = true
						return false
					}
					if nodeStart(file, callee) <= fix.Span.Pos() && callee.End() >= fix.Span.End() {
						ownsDiagnostic = true
					}
					sites = append(sites, site{call, wrapped, name})
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if unsafe || !ownsDiagnostic || len(sites) == 0 {
			continue
		}
		text := file.Text()
		var edits []sourceEdit
		imports := ""
		usedYield, usedInterrupt := false, false
		yield := retiredAwaitFresh(file, "$runtimeYieldNow")
		priority := retiredAwaitFresh(file, "$runtimeYieldNowWith")
		stop := retiredAwaitFresh(file, "$runtimeInterrupt")
		value := retiredAwaitFresh(file, "$runtimeYieldPriority")
		for _, site := range sites {
			start, end := nodeStart(file, site.callee), site.callee.End()
			comments := strings.Join(rewriteComments.FindAllString(text[start:end], -1), "\n")
			if comments != "" {
				comments += "\n"
			}
			replacement := "(" + comments + "() => " + stop + ")"
			if site.name == "yieldNow" {
				usedYield = true
				replacement = "(" + comments + "(" + value + "?: number) => " + value + " === undefined ? " + yield + " : " + priority + "(" + value + "))"
			} else {
				usedInterrupt = true
			}
			if !underTry(site.call) && continuesStatement(text, site.call, start) {
				replacement = ";" + replacement
			}
			edits = append(edits, sourceEdit{start, end, replacement})
		}
		if usedYield {
			imports = "yieldNow as " + yield + ", yieldNowWith as " + priority
		}
		if usedInterrupt {
			if imports != "" {
				imports += ", "
			}
			imports += "interrupt as " + stop
		}
		nativeImport := "\nimport { " + imports + " } from \"effect/Effect\";\n"
		// Keep the old dependency at its original place, before the new Effect
		// dependency. A bare edge survives TypeScript import elision as the used
		// old factory binding did. Import attributes remain on the original edge.
		if !namespace || !keepNamespace {
			all := importBindingsOf(file)
			only := true
			for _, other := range all {
				if other.declaration == statement && other.node != binding.node {
					only = false
				}
			}
			if only {
				replacement := "import " + text[nodeStart(file, module):statement.End()] + nativeImport
				edits = append(edits, sourceEdit{nodeStart(file, statement), statement.End(), replacement})
			} else {
				edits = append(edits, bindingRemovals(file, statement, []*ast.Node{binding.node})...)
				bare := "import " + text[nodeStart(file, module):statement.End()] + "\n"
				edits = append(edits, sourceEdit{nodeStart(file, statement), nodeStart(file, statement), bare}, sourceEdit{statement.End(), statement.End(), nativeImport})
			}
		} else {
			edits = append(edits, sourceEdit{statement.End(), statement.End(), nativeImport})
		}
		if !editsPreserveComments(text, edits) {
			continue
		}
		var changes []*lsproto.TextEdit
		for _, edit := range edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
		}
		return []*ls.CodeAction{{Description: retiredRuntimeFactoryTitle, Changes: changes}}, nil
	}
	return nil, nil
}
