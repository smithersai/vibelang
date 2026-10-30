package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// consistencyName returns the byte span of a name node written in text, or
// false for a name the parser synthesized or wrote another way, such as an
// escaped identifier.
func consistencyName(text string, name *ast.Node) (int, int, bool) {
	if name == nil || !ast.IsIdentifier(name) || ast.NodeIsMissing(name) {
		return 0, 0, false
	}
	start := name.End() - len(name.Text())
	if start < 0 || name.End() > len(text) || text[start:name.End()] != name.Text() {
		return 0, 0, false
	}
	return start, name.End(), true
}

// consistencyKindOf names the kind of the node that a name at a byte offset
// declares or belongs to, such as "FunctionDeclaration", for a gap's key.
func (p *consistencyProject) kindAt(file string, offset int) string {
	if node := p.nodeAt(file, offset); node != nil && node.Parent != nil {
		return strings.TrimPrefix(node.Parent.Kind.String(), "Kind")
	}
	return "none"
}

// callItems prepares the call hierarchy items of the main file's functions,
// classes and variables that hold a function, at their names (LSP 3.17,
// textDocument/prepareCallHierarchy). Methods and accessors are left out:
// TypeScript finds a member's incoming calls through its references, which
// take the members it overrides or implements (consistencyUnstable), so an
// override's incoming calls hold a `super.m()` its outgoing calls give to
// the base's member.
func (c *consistency) callItems() []*lsproto.CallHierarchyItem {
	p := c.before
	text := p.files[c.main]
	var offsets []int
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var name *ast.Node
		switch node.Kind {
		case ast.KindFunctionDeclaration, ast.KindClassDeclaration:
			name = node.Name()
		case ast.KindVariableDeclaration:
			if initializer := node.Initializer(); initializer != nil && (initializer.Kind == ast.KindArrowFunction || initializer.Kind == ast.KindFunctionExpression) {
				name = node.Name()
			}
		}
		if start, _, ok := consistencyName(text, name); ok && !slices.Contains(offsets, start) {
			offsets = append(offsets, start)
		}
		return node.ForEachChild(visit)
	}
	p.r.SourceFile(c.main).AsNode().ForEachChild(visit)
	slices.Sort(offsets)
	if len(offsets) > consistencyCallItems {
		var spread []int
		for i := range consistencyCallItems {
			spread = append(spread, offsets[i*len(offsets)/consistencyCallItems])
		}
		offsets = spread
	}
	uri := p.uri(c.main)
	var items []*lsproto.CallHierarchyItem
	seen := map[consistencySpan]bool{}
	for _, offset := range offsets {
		position := p.position(c.main, offset)
		c.where = fmt.Sprintf("%d:%d (byte %d)", position.Line, position.Character, offset)
		response, ok := consistencyRequest(c, p, "prepare call hierarchy", uri, func(s *ls.LanguageService) (lsproto.CallHierarchyPrepareResponse, error) {
			return s.ProvidePrepareCallHierarchy(c.ctx, uri, position)
		})
		if !ok || response.CallHierarchyItems == nil {
			continue
		}
		for _, item := range *response.CallHierarchyItems {
			if key := p.span(item.Uri, item.SelectionRange); !seen[key] {
				seen[key] = true
				items = append(items, item)
			}
		}
	}
	return items
}

// checkCallHierarchy checks that incoming and outgoing calls agree. LSP
// 3.17 defines a CallHierarchyIncomingCall's from as "The item that makes
// the call" and its fromRanges as "The ranges at which the calls appear.
// This is relative to the caller denoted by `this.from`", and a
// CallHierarchyOutgoingCall's to as "The item that is called" and its
// fromRanges as "The range at which this item is called. This is the range
// relative to the caller". Both describe the same calls, so among the main
// file's items, g's outgoing calls hold f exactly when f's incoming calls
// hold g, at the same calls. TypeScript's call hierarchy gives an incoming
// call the range of the reference to f, such as `find` in `Users.find(id)`,
// and an outgoing call the range of the callee expression, `Users.find`, so
// the calls correspond when each outgoing range holds exactly one incoming
// range and each incoming range lies in an outgoing one.
func (c *consistency) checkCallHierarchy() {
	p := c.before
	items := c.callItems()
	if len(items) == 0 {
		return
	}
	keys := map[consistencySpan]*lsproto.CallHierarchyItem{}
	for _, item := range items {
		keys[p.span(item.Uri, item.SelectionRange)] = item
	}
	// outgoing[g][f] and incoming[f][g] hold the ranges of g's calls of f.
	outgoing := map[consistencySpan]map[consistencySpan]map[consistencySpan]bool{}
	incoming := map[consistencySpan]map[consistencySpan]map[consistencySpan]bool{}
	ranges := func(uri lsproto.DocumentUri, rs []lsproto.Range) map[consistencySpan]bool {
		spans := map[consistencySpan]bool{}
		for _, r := range rs {
			spans[p.span(uri, r)] = true
		}
		return spans
	}
	for _, key := range consistencySorted(consistencyKeySet(keys)) {
		item := keys[key]
		c.where = fmt.Sprintf("the call hierarchy item %q at %s", item.Name, key)
		// An incoming call's fromRanges lie in its caller's document, which
		// toolsBadRanges cannot tell from the request's, so they are checked
		// here.
		if response, ok := consistencyRequest(c, p, "incoming calls", "", func(s *ls.LanguageService) (lsproto.CallHierarchyIncomingCallsResponse, error) {
			return s.ProvideCallHierarchyIncomingCalls(c.ctx, item, nil)
		}); ok && response.CallHierarchyIncomingCalls != nil {
			incoming[key] = map[consistencySpan]map[consistencySpan]bool{}
			for _, call := range *response.CallHierarchyIncomingCalls {
				from := p.span(call.From.Uri, call.From.SelectionRange)
				spans := ranges(call.From.Uri, call.FromRanges)
				for s := range spans {
					if from.inProject() && !s.inProject() {
						Gap(c.t, consistencyTarget, "consistency:range:incoming-calls", "LSP 3.17: %s: an incoming call from %s has the range %s, outside its caller's document\n%s", c.where, from, s, c.archive)
					}
				}
				incoming[key][from] = spans
			}
		}
		if response, ok := consistencyRequest(c, p, "outgoing calls", item.Uri, func(s *ls.LanguageService) (lsproto.CallHierarchyOutgoingCallsResponse, error) {
			return s.ProvideCallHierarchyOutgoingCalls(c.ctx, item)
		}); ok && response.CallHierarchyOutgoingCalls != nil {
			outgoing[key] = map[consistencySpan]map[consistencySpan]bool{}
			for _, call := range *response.CallHierarchyOutgoingCalls {
				outgoing[key][p.span(call.To.Uri, call.To.SelectionRange)] = ranges(item.Uri, call.FromRanges)
			}
		}
	}
	for g := range keys {
		for f := range keys {
			out, outOK := outgoing[g][f]
			in, inOK := incoming[f][g]
			c.where = fmt.Sprintf("the calls of %q (%s) from %q (%s)", keys[f].Name, f, keys[g].Name, g)
			kind := p.kindAt(g.file, g.start)
			switch {
			case outOK && !inOK:
				Gap(c.t, consistencyTarget, "consistency:call-hierarchy:incoming-missing:"+kind, "LSP 3.17: %s: %q's outgoing calls hold %q at %v, but %q's incoming calls do not hold %q\n%s", c.where, keys[g].Name, keys[f].Name, consistencySorted(out), keys[f].Name, keys[g].Name, c.archive)
			case inOK && !outOK:
				Gap(c.t, consistencyTarget, "consistency:call-hierarchy:outgoing-missing:"+kind, "LSP 3.17: %s: %q's incoming calls hold %q at %v, but %q's outgoing calls do not hold %q\n%s", c.where, keys[f].Name, keys[g].Name, consistencySorted(in), keys[g].Name, keys[f].Name, c.archive)
			case inOK && outOK:
				if diff := consistencyCallRanges(out, in); diff != "" {
					Gap(c.t, consistencyTarget, "consistency:call-hierarchy:from-ranges:"+kind, "LSP 3.17: %s: the incoming call's ranges differ from the outgoing call's: %s\n%s", c.where, diff, c.archive)
				}
			}
		}
	}
}

// consistencyCallRanges describes how the ranges of an outgoing call and of
// the matching incoming call fail to correspond one to one, each incoming
// range inside its outgoing range, or returns "".
func consistencyCallRanges(out, in map[consistencySpan]bool) string {
	var problems []string
	for o := range out {
		n := 0
		for i := range in {
			if i.file == o.file && o.start <= i.start && i.end <= o.end {
				n++
			}
		}
		if n != 1 {
			problems = append(problems, fmt.Sprintf("the outgoing range %s holds %d incoming ranges", o, n))
		}
	}
	for i := range in {
		if !slices.ContainsFunc(slices.Collect(maps.Keys(out)), func(o consistencySpan) bool { return i.file == o.file && o.start <= i.start && i.end <= o.end }) {
			problems = append(problems, fmt.Sprintf("the incoming range %s lies in no outgoing range", i))
		}
	}
	slices.Sort(problems)
	if len(problems) == 0 {
		return ""
	}
	return fmt.Sprintf("%s; outgoing %v, incoming %v", strings.Join(problems, "; "), consistencySorted(out), consistencySorted(in))
}

func consistencyKeySet[V any](m map[consistencySpan]V) map[consistencySpan]bool {
	set := map[consistencySpan]bool{}
	for key := range m {
		set[key] = true
	}
	return set
}

// A consistencyDeclaration is a name a top-level statement of the main file
// declares.
type consistencyDeclaration struct {
	name       string
	kind       string // the statement's kind, such as "VariableStatement"
	start, end int
}

// topLevel returns the names the main file's top-level statements declare:
// its variables, including those of binding patterns, functions, classes,
// interfaces, type aliases, enums and modules, each where it is written. A
// VibeLang declaration, such as `error E`, `service S` or `schema T`, is the
// class, constant or type its Effect reading declares (SKILL.md's Forms),
// under the name written in the source.
func (c *consistency) topLevel() []consistencyDeclaration {
	p := c.before
	text := p.files[c.main]
	var declarations []consistencyDeclaration
	add := func(statement, name *ast.Node) {
		start, end, ok := consistencyName(text, name)
		if !ok || slices.ContainsFunc(declarations, func(d consistencyDeclaration) bool { return d.start == start && d.name == name.Text() }) {
			return
		}
		declarations = append(declarations, consistencyDeclaration{name.Text(), strings.TrimPrefix(statement.Kind.String(), "Kind"), start, end})
	}
	var bind func(statement, name *ast.Node)
	bind = func(statement, name *ast.Node) {
		if name != nil && ast.IsBindingPattern(name) {
			for _, element := range name.Elements() {
				if element.Kind == ast.KindBindingElement {
					bind(statement, element.Name())
				}
			}
			return
		}
		add(statement, name)
	}
	for _, statement := range p.r.SourceFile(c.main).Statements.Nodes {
		switch statement.Kind {
		case ast.KindVariableStatement:
			for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				bind(statement, declaration.Name())
			}
		case ast.KindFunctionDeclaration, ast.KindClassDeclaration, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEnumDeclaration, ast.KindModuleDeclaration:
			add(statement, statement.Name())
		}
	}
	return declarations
}

// checkSymbols checks document and workspace symbols against the main file's
// top-level declarations.
//
// LSP 3.17's textDocument/documentSymbol lists "all symbols found in a given
// text document", and a DocumentSymbol's selectionRange is "the name of a
// function. Must be contained by the `range`". workspace/symbol lists
// "project-wide symbols matching the query string". TypeScript's document
// symbols list every top-level declaration but imports, each selecting its
// name, and its workspace symbols find each declaration by its name, at the
// name's span (navigateTo). A .vibe file is read as its Effect TypeScript
// (SKILL.md, D32), whose declarations are the ones topLevel returns.
func (c *consistency) checkSymbols() {
	p := c.before
	uri := p.uri(c.main)
	declarations := c.topLevel()
	capabilities := &lsproto.ResolvedClientCapabilities{}
	capabilities.TextDocument.DocumentSymbol.HierarchicalDocumentSymbolSupport = true
	ctx := lsproto.WithClientCapabilities(c.ctx, capabilities)
	c.where = "the document symbols of " + c.main
	response, ok := consistencyRequest(c, p, "document symbols", uri, func(s *ls.LanguageService) (lsproto.DocumentSymbolResponse, error) {
		return s.ProvideDocumentSymbols(ctx, uri)
	})
	if ok && response.DocumentSymbols != nil {
		lines := p.linesOf(c.main)
		var found []consistencySpan // the selection ranges of the symbols, by name in file
		var walk func(symbols []*lsproto.DocumentSymbol)
		walk = func(symbols []*lsproto.DocumentSymbol) {
			for _, symbol := range symbols {
				selectionStart, selectionEnd, ok1 := lines.span(symbol.SelectionRange)
				start, end, ok2 := lines.span(symbol.Range)
				if ok1 && ok2 && (selectionStart < start || end < selectionEnd) {
					Gap(c.t, consistencyTarget, "consistency:document-symbols:selection-outside:"+p.kindAt(c.main, selectionStart), "LSP 3.17: the document symbol %q selects [%d, %d), outside its range [%d, %d)\n%s", symbol.Name, selectionStart, selectionEnd, start, end, c.archive)
				}
				if ok1 {
					found = append(found, consistencySpan{symbol.Name, selectionStart, selectionEnd})
				}
				if symbol.Children != nil {
					walk(*symbol.Children)
				}
			}
		}
		walk(*response.DocumentSymbols)
		for _, d := range declarations {
			// TypeScript names `namespace A.B { }` "A.B".
			if !slices.ContainsFunc(found, func(s consistencySpan) bool {
				return (s.file == d.name || d.kind == "ModuleDeclaration" && strings.HasPrefix(s.file, d.name+".")) && s.start <= d.start && d.end <= s.end
			}) {
				Gap(c.t, consistencyTarget, "consistency:document-symbols:missing:"+d.kind+":"+p.kindAt(c.main, d.start), "LSP 3.17: no document symbol names the top-level %s %q at bytes %d-%d: %v\n%s", d.kind, d.name, d.start, d.end, found, c.archive)
			}
		}
	}
	for i, d := range declarations {
		if i == consistencyNames {
			break
		}
		c.where = fmt.Sprintf("the workspace symbol query %q", d.name)
		symbols, ok := consistencyRequest(c, p, "workspace symbols", uri, func(s *ls.LanguageService) (lsproto.WorkspaceSymbolResponse, error) {
			return ls.ProvideWorkspaceSymbols(c.ctx, []*compiler.Program{p.r.Program}, p.converters, toolsPreferences(), d.name)
		})
		if !ok {
			continue
		}
		// TypeScript's navigateTo lists an overloaded function once, so any
		// symbol of the name in the main file finds the declaration.
		want := consistencySpan{c.main, d.start, d.end}
		var named []string
		found := false
		if symbols.SymbolInformations != nil {
			for _, symbol := range *symbols.SymbolInformations {
				if symbol.Name == d.name {
					s := p.span(symbol.Location.Uri, symbol.Location.Range)
					named = append(named, s.String())
					found = found || s.file == c.main
				}
			}
		}
		if !found {
			Gap(c.t, consistencyTarget, "consistency:workspace-symbols:missing:"+d.kind+":"+p.kindAt(c.main, d.start), "LSP 3.17: %s does not find the top-level %s %q at %s; symbols of that name: %v\n%s", c.where, d.kind, d.name, want, named, c.archive)
		}
	}
}
