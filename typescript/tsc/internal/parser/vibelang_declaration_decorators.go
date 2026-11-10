package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// vibelangDeclarationDecorators rejects the decorators before a VibeLang
// declaration and returns the remaining modifiers. Appendix A's
// DeclarationStart has no DecoratorList: `service`, `error`, `schema` and
// `data` follow TypeScript's `type`, so `@dec service S { }` is TypeScript's
// "Decorators are not valid here" (TS1206) at the first decorator, as
// `@dec type T = 1` is. The decorators leave the modifier list, so the
// lowered declaration never applies them; `export` and `declare` keep their
// own checks.
func (p *Parser) vibelangDeclarationDecorators(modifiers *ast.ModifierList) *ast.ModifierList {
	if modifiers == nil {
		return nil
	}
	var first *ast.Node
	kept := make([]*ast.Node, 0, len(modifiers.Nodes))
	for _, modifier := range modifiers.Nodes {
		if ast.IsDecorator(modifier) {
			if first == nil {
				first = modifier
			}
			continue
		}
		kept = append(kept, modifier)
	}
	if first == nil {
		return modifiers
	}
	start := scanner.SkipTrivia(p.sourceText, first.Pos())
	p.parseErrorAt(start, start+1, diagnostics.Decorators_are_not_valid_here) // the `@`, as checker/grammarchecks.go reports it
	if len(kept) == 0 {
		return nil
	}
	return p.newModifierList(core.NewTextRange(kept[0].Pos(), kept[len(kept)-1].End()), p.nodeSliceArena.Clone(kept))
}
