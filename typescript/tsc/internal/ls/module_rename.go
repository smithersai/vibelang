package ls

import (
	"context"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
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
	occurrences := l.moduleDeclarationFileOccurrences(uri)
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
	var named []moduleOccurrence
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

// moduleDeclarationFileOccurrences collects a file's written module names
// once, independent of the number of references a native symbol returned.
func (l *LanguageService) moduleDeclarationFileOccurrences(uri lsproto.DocumentUri) []moduleOccurrence {
	// TypeScript's answers can name a file outside the program, such as a
	// library source a declaration map points to; it declares no module.
	_, file := l.tryGetProgramAndFile(uri.FileName())
	// Reference answers may contain thousands of library occurrences. Those
	// files cannot contribute a written embedded-module binding; walking
	// their syntax tree once per returned reference makes this quadratic.
	if file == nil || len(file.EmbeddedModules()) == 0 {
		return nil
	}
	var occurrences []moduleOccurrence
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
				name := target.Text()
				if reference {
					if module := file.EmbeddedModuleBySpecifier(node.Text()); module != nil {
						name = module.EmbeddedModule().Name
					}
				}
				occurrences = append(occurrences, moduleOccurrence{name, span, declaration})
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return occurrences
}

// moduleDeclarationFollowers extends a rename or references answer from the
// TypeScript symbol path. A VibeLang module declaration merges with a symbol
// of the same name, such as an imported type, so TypeScript renames its name;
// the written specifiers that name the module must follow, or they name a
// module that no longer exists (VIP-40). It returns, for each document, the
// other written occurrences of each module declaration name among ranges.
func (l *LanguageService) moduleDeclarationFollowers(uri lsproto.DocumentUri, ranges []lsproto.Range) []moduleOccurrence {
	occurrences := l.moduleDeclarationFileOccurrences(uri)
	if len(occurrences) == 0 {
		return nil
	}
	seen := map[lsproto.Range]bool{}
	for _, r := range ranges {
		seen[r] = true
	}
	names := map[string]bool{}
	for _, item := range occurrences {
		if item.declaration && seen[item.span] {
			names[item.name] = true
		}
	}
	var followers []moduleOccurrence
	for _, item := range occurrences {
		if names[item.name] && !seen[item.span] {
			seen[item.span] = true
			followers = append(followers, item)
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

func isModuleDeclarationName(node *ast.Node) bool {
	return node != nil && node.Parent != nil && parser.IsVibeLangModuleDeclaration(node.Parent) && node.Parent.Name() == node
}

// followModuleDeclarationHighlights follows the reference set of a module
// binding, including native symbols merged with it during error recovery.
func (l *LanguageService) followModuleDeclarationHighlights(response lsproto.MultiDocumentHighlightsOrNull, references lsproto.ReferencesResponse) {
	if response.MultiDocumentHighlights == nil || references.Locations == nil {
		return
	}
	moduleBinding := false
	for _, location := range *references.Locations {
		_, trigger, occurrences, ok := l.moduleDeclarationOccurrences(location.Uri, location.Range.Start)
		if ok && trigger == location.Range && slices.ContainsFunc(occurrences, func(item moduleOccurrence) bool { return item.declaration && item.span == trigger }) {
			moduleBinding = true
			break
		}
	}
	if !moduleBinding {
		return
	}
	documents := map[lsproto.DocumentUri]*lsproto.MultiDocumentHighlight{}
	seen := map[lsproto.DocumentUri]map[lsproto.Range]bool{}
	for _, document := range *response.MultiDocumentHighlights {
		documents[document.Uri] = document
		seen[document.Uri] = map[lsproto.Range]bool{}
		for _, highlight := range document.Highlights {
			seen[document.Uri][highlight.Range] = true
		}
	}
	for _, location := range *references.Locations {
		document := documents[location.Uri]
		if document == nil || seen[location.Uri][location.Range] {
			continue
		}
		seen[location.Uri][location.Range] = true
		highlight := &lsproto.DocumentHighlight{Range: location.Range}
		_, _, occurrences, ok := l.moduleDeclarationOccurrences(location.Uri, location.Range.Start)
		if ok {
			kind := lsproto.DocumentHighlightKindRead
			if slices.ContainsFunc(occurrences, func(item moduleOccurrence) bool { return item.declaration && item.span == location.Range }) {
				kind = lsproto.DocumentHighlightKindWrite
			}
			highlight.Kind = &kind
		}
		document.Highlights = append(document.Highlights, highlight)
	}
}

// referenceCanMergeModule limits alias closure to identifiers whose spelling
// is also a module declaration of their file. Other symbols keep native queries.
func (l *LanguageService) referenceCanMergeModule(location lsproto.Location, namesByURI map[lsproto.DocumentUri]map[string]bool) bool {
	_, file := l.tryGetProgramAndFile(location.Uri.FileName())
	if file == nil || len(file.EmbeddedModules()) == 0 {
		return false
	}
	names, indexed := namesByURI[location.Uri]
	if !indexed {
		names = map[string]bool{}
		for _, statement := range file.Statements.Nodes {
			if parser.IsVibeLangModuleDeclaration(statement) && !ast.NodeIsMissing(statement.Name()) {
				names[statement.Name().Text()] = true
			}
		}
		namesByURI[location.Uri] = names
	}
	for _, mapped := range l.converters.FromLSPPositionForSourceFile(file, location.Range.Start, spanmap.FeatureReferences) {
		if !mapped.Fidelity.IsSingleSegment() {
			continue
		}
		node := astnav.GetTouchingPropertyName(mapped.Script, int(mapped.Position))
		if node == nil || !ast.IsIdentifier(node) || !names[node.Text()] {
			continue
		}
		if _, _, _, module := l.moduleDeclarationOccurrences(location.Uri, location.Range.Start); module {
			return false
		}
		return true
	}
	return false
}

// expandModuleReferenceAliases closes the native alias path before adding
// written module specifiers. Looking up the imported declaration must find
// the same recovery binding as looking up its alias in the containing file.
func (l *LanguageService) expandModuleReferenceAliases(ctx context.Context, params *lsproto.ReferenceParams, orchestrator CrossProjectOrchestrator, response lsproto.ReferencesResponse) error {
	if response.Locations == nil {
		return nil
	}
	includeDeclaration := params.Context != nil && params.Context.IncludeDeclaration
	seen := map[lsproto.Location]bool{}
	for _, location := range *response.Locations {
		seen[location] = true
	}
	appendLocation := func(location lsproto.Location) {
		if !seen[location] {
			seen[location] = true
			*response.Locations = append(*response.Locations, location)
		}
	}
	// Index declaration spellings once per document before considering native
	// occurrences; an unrelated symbol must not trigger a module-tree scan.
	namesByURI := map[lsproto.DocumentUri]map[string]bool{}
	for index := 0; index < len(*response.Locations); index++ {
		location := (*response.Locations)[index]
		if !l.referenceCanMergeModule(location, namesByURI) {
			continue
		}
		at := *params
		at.TextDocument = lsproto.TextDocumentIdentifier{Uri: location.Uri}
		at.Position = location.Range.Start
		at.Context = &lsproto.ReferenceContext{IncludeDeclaration: true}
		native, err := l.handleCrossProject(ctx, &at, orchestrator, (*LanguageService).symbolAndEntriesToReferences,
			combineReferences, false, false, symbolEntryTransformOptions{}, nil)
		if err != nil {
			return err
		}
		if native.Locations == nil {
			continue
		}
		if includeDeclaration {
			for _, found := range *native.Locations {
				appendLocation(found)
			}
		} else {
			at.Context = &lsproto.ReferenceContext{IncludeDeclaration: false}
			uses, err := l.handleCrossProject(ctx, &at, orchestrator, (*LanguageService).symbolAndEntriesToReferences,
				combineReferences, false, false, symbolEntryTransformOptions{}, nil)
			if err != nil {
				return err
			}
			if uses.Locations != nil {
				for _, found := range *uses.Locations {
					appendLocation(found)
				}
			}
		}
		for _, found := range *native.Locations {
			_, trigger, occurrences, ok := l.moduleDeclarationOccurrences(found.Uri, found.Range.Start)
			if !ok || trigger != found.Range {
				continue
			}
			if !slices.ContainsFunc(occurrences, func(item moduleOccurrence) bool { return item.declaration && item.span == trigger }) {
				continue
			}
			for _, item := range occurrences {
				if includeDeclaration || !item.declaration {
					appendLocation(lsproto.Location{Uri: found.Uri, Range: item.span})
				}
			}
		}
	}
	return nil
}
