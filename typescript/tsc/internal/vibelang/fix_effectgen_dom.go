package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// generatorGlobalConstructors preserves a native constructor when an Effect
// generator becomes explicit effect code. EK1002 suppresses the body's
// TypeScript errors, so the proposal must preserve the global constructor even
// when an implicit prelude name resolves to a non-constructable namespace.
// Local and imported bindings keep their original meaning. This does not exempt
// the global from the platform boundary (VIP-33).
func generatorGlobalConstructors(c *checker.Checker, file *ast.SourceFile, body *ast.Node) ([]sourceEdit, string) {
	var edits []sourceEdit
	var why string
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsNewExpression(node) {
			name := ast.SkipParentheses(node.Expression())
			if ast.IsIdentifier(name) && !shadowedByValue(name, name.Text()) {
				global := c.GlobalSymbol(name.Text(), ast.SymbolFlagsValue)
				resolved := c.ResolveName(name.Text(), name, ast.SymbolFlagsValue, false)
				if global != nil && resolved != nil && resolved != global &&
					global.Flags()&ast.SymbolFlagsFunctionScopedVariable != 0 &&
					len(c.GetSignaturesOfType(c.GetTypeOfSymbol(global), checker.SignatureKindConstruct)) != 0 &&
					len(c.GetSignaturesOfType(c.GetTypeAtLocation(name), checker.SignatureKindConstruct)) == 0 {
					root := c.ResolveName("globalThis", name, ast.SymbolFlagsValue, false)
					if root == nil || root.Name() != "globalThis" || len(root.Declarations()) != 0 {
						why = "the global constructor " + name.Text() + " would be hidden by the prelude, and globalThis is shadowed"
						return true
					}
					at := nodeStart(file, name)
					edits = append(edits, sourceEdit{at, at, "globalThis."})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	visit(body)
	return edits, why
}

// preserveGeneratorConstructors restores the native binding before the fix
// gate takes its baseline. Qualifying it together with EK1002's replacement
// would make the host diagnostic look newly introduced. The existing host
// operation must instead be visible to the gate; every subsequent rewrite
// still has to preserve all diagnostics, including EK4402.
func preserveGeneratorConstructors(ctx context.Context, program *compiler.Program, scope *fixScope, texts map[tspath.RootedFilePath]string, result *FixResult) bool {
	changed := false
	for _, file := range scope.fixable(program) {
		c, done := program.GetTypeCheckerForFile(ctx, file)

		var edits []sourceEdit
		seen := map[*ast.Node]bool{}
		qualified := map[int]bool{}
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsNewExpression(node) {
				for parent := node.Parent; parent != nil; parent = parent.Parent {
					if !isGeneratorExpression(parent) {
						continue
					}
					if seen[parent] {
						break
					}
					seen[parent] = true
					call := parent.Parent
					if g, why := readGeneratorCall(c, file, call); g != nil && why == "" && g.generator == parent {
						if rewrite := planEffectGen(c, file, call); rewrite.fixable() {
							qualifications, why := generatorGlobalConstructors(c, file, parent.Body())
							if why == "" {
								// Nested generators can share a constructor visit.
								for _, edit := range qualifications {
									if !qualified[edit.start] {
										qualified[edit.start] = true
										edits = append(edits, edit)
									}
								}
							}
						}
					}
					break
				}
			}
			return node.ForEachChild(visit)
		}
		visit(file.AsNode())
		done()
		if len(edits) == 0 {
			continue
		}
		name := file.FileName()
		fixed := result.Files[name]
		if fixed == nil {
			fixed = &FixedFile{Original: file.Text(), Counts: map[int32]int{}}
			result.Files[name] = fixed
			result.Order = append(result.Order, name)
		}
		if fixed.Rewrites == nil {
			fixed.Rewrites = map[string]int{}
		}
		fixed.Rewrites["generator constructor bindings"] += len(edits)
		fixed.Text = applyEdits(file.Text(), edits)
		texts[name] = fixed.Text
		changed = true
	}
	return changed
}
