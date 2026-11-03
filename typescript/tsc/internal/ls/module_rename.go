package ls

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A module name is a lexical binding, but its identifier specifiers are
// represented by synthetic string paths. Rename only their written ranges,
// never a virtual file or a quoted package specifier (VIP-40).
func (l *LanguageService) moduleDeclarationRename(uri lsproto.DocumentUri, position lsproto.Position, newName string) (RenameInfo, map[lsproto.DocumentUri][]*lsproto.TextEdit, bool) {
	_, file := l.getProgramAndFile(uri)
	if file == nil {
		return RenameInfo{}, nil, false
	}
	type occurrence struct {
		name        string
		span        lsproto.Range
		declaration bool
	}
	var occurrences []occurrence
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		declaration := parser.IsVibeLangModuleDeclaration(node)
		reference := parser.IsVibeLangModuleReference(node)
		if declaration || reference {
			target := node
			if declaration {
				target = node.Name()
			}
			// Recovery may supply an empty name while a module is being typed.
			// It has no source occurrence to rename.
			if ast.NodeIsMissing(target) {
				return false
			}
			start := scanner.SkipTrivia(file.Text(), target.Pos())
			span, fidelity := l.converters.ToLSPRange(file, core.NewTextRange(start, target.End()))
			if fidelity.IsExact() {
				occurrences = append(occurrences, occurrence{file.Text()[start:target.End()], span, declaration})
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	name := ""
	var trigger lsproto.Range
	for _, item := range occurrences {
		if lsproto.ComparePositions(item.span.Start, position) <= 0 && lsproto.ComparePositions(position, item.span.End) <= 0 {
			name, trigger = item.name, item.span
			break
		}
	}
	if name == "" {
		return RenameInfo{}, nil, false
	}
	declared := false
	for _, item := range occurrences {
		if item.declaration && item.name == name {
			declared = true
		}
	}
	if !declared {
		return RenameInfo{}, nil, false
	}
	if !scanner.IsIdentifierText(newName, core.LanguageVariantStandard) || ast.IsNonContextualKeyword(scanner.StringToToken(newName)) {
		return RenameInfo{}, nil, true
	}
	changes := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
	for _, item := range occurrences {
		if item.name == name {
			changes[uri] = append(changes[uri], &lsproto.TextEdit{Range: item.span, NewText: newName})
		}
	}
	return RenameInfo{CanRename: true, DisplayName: name, TriggerSpan: trigger}, changes, true
}
