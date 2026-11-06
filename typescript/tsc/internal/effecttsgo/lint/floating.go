package lint

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rule"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Registered during compiler initialization so the adapter uses the language's
// source placement rules without duplicating them in the imported runner.
var vibeFloatingExclusion func(*ast.Node) bool

// RegisterVibeFloatingExclusion installs the language placement check at initialization.
func RegisterVibeFloatingExclusion(exclude func(*ast.Node) bool) {
	vibeFloatingExclusion = exclude
}

func init() {
	// Keep the pinned rule's eligibility and diagnostic construction. Its
	// primitive-expression shortcut excludes arrows, while the parser represents
	// effect { ... } as an arrow whose token stands on `effect`. Adapt that one
	// syntax node inside the runner, and exclude source placement errors through
	// the language check. File exclusions, directives, category resolution and
	// diagnostic identity still follow the imported rule.
	for i := range rules.All {
		if rules.All[i].Name != "floatingEffect" {
			continue
		}
		upstream := rules.All[i].Run
		rules.All[i].Run = func(ctx *rule.Context) []*ast.Diagnostic {
			result := upstream(ctx)
			if !ctx.SourceFile.IsVibeLang() {
				return result
			}
			var excluded map[[2]int]bool
			var visit ast.Visitor
			visit = func(node *ast.Node) bool {
				if ast.IsExpressionStatement(node) {
					expression := node.Expression()
					if vibeFloatingExclusion != nil && vibeFloatingExclusion(expression) {
						if excluded == nil {
							excluded = map[[2]int]bool{}
						}
						r := ctx.GetErrorRange(expression)
						excluded[[2]int{r.Pos(), r.End()}] = true
					}
					if ast.IsArrowFunction(expression) && expression.Flags&ast.NodeFlagsVibeLangEffect != 0 {
						token := expression.AsArrowFunction().EqualsGreaterThanToken
						r := scanner.GetRangeOfTokenAtPosition(ctx.SourceFile, token.Pos())
						if ctx.SourceFile.Text()[r.Pos():r.End()] == "effect" {
							result = append(result, ctx.NewDiagnostic(ctx.SourceFile, ctx.GetErrorRange(expression), diagnostics.This_Effect_value_is_neither_yielded_nor_used_in_an_assignment_effect_floatingEffect, nil))
						}
					}
				}
				return node.ForEachChild(visit)
			}
			visit(ctx.SourceFile.AsNode())
			if len(excluded) != 0 {
				result = slices.DeleteFunc(result, func(d *ast.Diagnostic) bool {
					return excluded[[2]int{d.Pos(), d.End()}]
				})
			}
			return result
		}
	}
}
