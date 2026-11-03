package ls

import (
	"slices"

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
	name, trigger, occurrences, ok := l.moduleDeclarationOccurrences(uri, position)
	if !ok {
		return RenameInfo{}, nil, false
	}
	if !scanner.IsIdentifierText(newName, core.LanguageVariantStandard) || ast.IsNonContextualKeyword(scanner.StringToToken(newName)) {
		return RenameInfo{}, nil, true
	}
	changes := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
	for _, item := range occurrences {
		changes[uri] = append(changes[uri], &lsproto.TextEdit{Range: item.span, NewText: newName})
	}
	return RenameInfo{CanRename: true, DisplayName: name, TriggerSpan: trigger}, changes, true
}

// moduleDeclarationAt reports whether position is on a written name of a
// module declared in the file, with the position of its declaration's name
// and every written occurrence of the name.
func (l *LanguageService) moduleDeclarationAt(uri lsproto.DocumentUri, position lsproto.Position) (lsproto.Position, []moduleOccurrence, bool) {
	_, _, occurrences, ok := l.moduleDeclarationOccurrences(uri, position)
	if !ok {
		return lsproto.Position{}, nil, false
	}
	for _, item := range occurrences {
		if item.declaration {
			return item.span.Start, occurrences, true
		}
	}
	return lsproto.Position{}, nil, false
}

// withModuleOccurrences adds a module's written names to TypeScript's
// references, the declaration only when the client asks for it: LSP 3.17
// makes a rename's edits the symbol's references (VIP-40).
func (l *LanguageService) withModuleOccurrences(response lsproto.ReferencesResponse, uri lsproto.DocumentUri, occurrences []moduleOccurrence, includeDeclaration bool) lsproto.ReferencesResponse {
	locations := []lsproto.Location{}
	if response.Locations != nil {
		locations = append(locations, *response.Locations...)
	}
	for _, item := range occurrences {
		location := lsproto.Location{Uri: uri, Range: item.span}
		if item.declaration && !includeDeclaration || slices.Contains(locations, location) {
			continue
		}
		locations = append(locations, location)
	}
	return lsproto.LocationsOrNull{Locations: &locations}
}

type moduleOccurrence struct {
	name        string
	span        lsproto.Range
	declaration bool
}

// moduleDeclarationOccurrences returns the written name at position and every
// written occurrence of it, when position is on a module declared in the file.
func (l *LanguageService) moduleDeclarationOccurrences(uri lsproto.DocumentUri, position lsproto.Position) (string, lsproto.Range, []moduleOccurrence, bool) {
	// TypeScript's answers can name a file outside the program, such as a
	// library source a declaration map points to; it declares no module.
	_, file := l.tryGetProgramAndFile(uri.FileName())
	if file == nil {
		return "", lsproto.Range{}, nil, false
	}
	type occurrence = moduleOccurrence
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
		return "", lsproto.Range{}, nil, false
	}
	declared := false
	var named []occurrence
	for _, item := range occurrences {
		if item.name == name {
			named = append(named, item)
			declared = declared || item.declaration
		}
	}
	if !declared {
		return "", lsproto.Range{}, nil, false
	}
	return name, trigger, named, true
}

// moduleDeclarationFollowers extends a rename or references answer from the
// TypeScript symbol path. A VibeLang module declaration merges with a symbol
// of the same name, such as an imported type, so TypeScript renames its name;
// the written specifiers that name the module must follow, or they name a
// module that no longer exists (VIP-40). It returns, for each document, the
// other written occurrences of each module declaration name among ranges.
func (l *LanguageService) moduleDeclarationFollowers(uri lsproto.DocumentUri, ranges []lsproto.Range) []moduleOccurrence {
	var followers []moduleOccurrence
	seen := map[lsproto.Range]bool{}
	for _, r := range ranges {
		seen[r] = true
	}
	for _, r := range ranges {
		_, trigger, occurrences, ok := l.moduleDeclarationOccurrences(uri, r.Start)
		if !ok || trigger != r {
			continue
		}
		declaration := false
		for _, item := range occurrences {
			declaration = declaration || item.declaration && item.span == r
		}
		if !declaration {
			continue
		}
		for _, item := range occurrences {
			if !seen[item.span] {
				seen[item.span] = true
				followers = append(followers, item)
			}
		}
	}
	return followers
}

// followModuleDeclarationRenames adds the specifier edits of each module
// declaration a TypeScript rename renamed.
func (l *LanguageService) followModuleDeclarationRenames(response lsproto.WorkspaceEditOrNull) {
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
		return
	}
	changes := *response.WorkspaceEdit.Changes
	for uri, edits := range changes {
		texts := map[lsproto.Range]string{}
		ranges := make([]lsproto.Range, 0, len(edits))
		for _, edit := range edits {
			texts[edit.Range] = edit.NewText
			ranges = append(ranges, edit.Range)
		}
		for _, r := range ranges {
			for _, item := range l.moduleDeclarationFollowers(uri, []lsproto.Range{r}) {
				if _, done := texts[item.span]; !done {
					texts[item.span] = texts[r]
					edits = append(edits, &lsproto.TextEdit{Range: item.span, NewText: texts[r]})
				}
			}
		}
		changes[uri] = edits
	}
}

// followModuleDeclarationReferences adds the specifiers of each module
// declaration among TypeScript's references, as rename edits them.
func (l *LanguageService) followModuleDeclarationReferences(response lsproto.ReferencesResponse) {
	if response.Locations == nil {
		return
	}
	byURI := map[lsproto.DocumentUri][]lsproto.Range{}
	for _, location := range *response.Locations {
		byURI[location.Uri] = append(byURI[location.Uri], location.Range)
	}
	for uri, ranges := range byURI {
		for _, item := range l.moduleDeclarationFollowers(uri, ranges) {
			*response.Locations = append(*response.Locations, lsproto.Location{Uri: uri, Range: item.span})
		}
	}
}
