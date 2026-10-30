package vibelangfuzz

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// consistencyTarget names FuzzEditorConsistency in gaps and pending lines.
const consistencyTarget = "FuzzEditorConsistency"

// FuzzEditorConsistency asks the language server for answers that must agree
// with each other and with the program. The server is the fork's own
// TypeScript server (Chapter 28, "The editor", D32), so its answers on a
// .vibe file are TypeScript's answers on the file's Effect reading (SKILL.md:
// "Read and write it as Effect code; that reading is never wrong"). FuzzEditor
// checks that each answer is well formed; this target checks the relations
// LSP 3.17, TypeScript's own semantics and Chapter 28's "Rewrites keep
// meaning" (D372) require between answers:
//
//   - References. Asking at a symbol's reference gives a set that holds that
//     reference and the symbol's definition; asking at each other reference
//     gives the same set; go-to-definition at each reference gives the same
//     declarations; document highlights in a file are the references in that
//     file (consistency_fuzz_test.go).
//   - Rename. Renaming a symbol to a fresh name edits only its references,
//     reports the same diagnostics by code, and the new name's references
//     are the old name's, mapped through the edit (consistency_rename_test.go).
//   - Organize imports. It keeps a file parsing, adds no error, keeps every
//     diagnostic outside the imports it rewrites, and a second run changes
//     nothing (consistency_rename_test.go).
//   - Call hierarchy. f is among g's outgoing calls, at the same ranges,
//     exactly when g is among f's incoming calls (consistency_outline_test.go).
//   - Symbols. Document symbols name every top-level declaration at its name,
//     each inside its own range, and workspace symbols find each by name
//     (consistency_outline_test.go).
//   - Selection ranges. One per position, each holding its position and
//     inside its parent (this file).
//
// offsets holds big-endian pairs of bytes, each a byte offset into the main
// file modulo its length: the positions of the selection ranges, and the
// symbols probed, each the first one referenced at or after an offset.
func FuzzEditorConsistency(f *testing.F) {
	startShortBudget(f)
	seeds := append(toolsSample(CaseSeeds(), 10, 300, nil), toolsSample(SnippetSeeds(), 8, 200, nil)...)
	for _, seed := range seeds {
		main := toolsMainFile(seed.Files)
		if main == "" {
			continue
		}
		f.Add(Archive(seed.Files), toolsInterestingOffsets(seed.Files[main]))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, archive string, offsets []byte) {
		toolsGuard(t, consistencyTarget, func() {
			files := toolsUnarchive(archive)
			for name, text := range files {
				files[name] = strings.ToValidUTF8(text, "?") // an LSP document is UTF-8
			}
			main := toolsMainFile(files)
			if main == "" || toolsTooLarge(files) || toolsLeftOut(consistencyTarget, files) {
				return
			}
			r := toolsCompile(t, w, consistencyTarget, files)
			defer r.Remove()
			if r.SourceFile(main) == nil {
				return // a tsconfig that leaves the file out of its program
			}
			c := &consistency{t: t, ctx: t.Context(), w: w, archive: archive, main: main}
			c.before = c.project(r, files)
			c.check(offsets)
		})
	})
}

// The number of things one input probes, so that an input stays fast.
const (
	consistencySymbols    = 3 // symbols whose references, definition and rename are checked
	consistencyReferences = 6 // references of a symbol asked again
	consistencyCallItems  = 6 // call hierarchy items
	consistencyNames      = 5 // top-level names looked up as workspace symbols
	consistencyPositions  = 8 // selection range positions
)

// A consistency holds one FuzzEditorConsistency input.
type consistency struct {
	t       *testing.T
	ctx     context.Context
	w       *Workspace
	archive string
	main    string
	before  *consistencyProject
	where   string // the request's position, for a report
}

// A consistencyProject is one compiled version of the input's project and a
// language service over it.
type consistencyProject struct {
	r          *Result
	files      map[string]string
	service    *ls.LanguageService
	converters *lsconv.Converters
	lines      map[string]*toolsLines
}

func (c *consistency) project(r *Result, files map[string]string) *consistencyProject {
	service, converters := toolsService(c.w, r.Program, toolsFileName(r.Dir, c.main))
	return &consistencyProject{r: r, files: files, service: service, converters: converters, lines: map[string]*toolsLines{}}
}

func (p *consistencyProject) uri(name string) lsproto.DocumentUri { return toolsURI(p.r.Dir, name) }

func (p *consistencyProject) linesOf(name string) *toolsLines {
	if l, ok := p.lines[name]; ok {
		return l
	}
	l := newToolsLines(p.files[name])
	p.lines[name] = l
	return l
}

// position returns the LSP position of a byte offset of a project file.
func (p *consistencyProject) position(name string, offset int) lsproto.Position {
	return p.linesOf(name).position(offset)
}

// A consistencySpan is a range of a project file in bytes. A range in a
// document outside the project keeps its URI and LSP range in file, with
// start and end -1.
type consistencySpan struct {
	file       string
	start, end int
}

func (s consistencySpan) String() string {
	if s.start < 0 {
		return s.file
	}
	return fmt.Sprintf("%s:%d-%d", s.file, s.start, s.end)
}

// inProject reports whether the span lies in a file of the project.
func (s consistencySpan) inProject() bool { return s.start >= 0 }

// span converts an LSP location of p to a span.
func (p *consistencyProject) span(uri lsproto.DocumentUri, r lsproto.Range) consistencySpan {
	name := strings.TrimPrefix(uri.FileName().AsString(), filepath.ToSlash(p.r.Dir)+"/")
	if _, ok := p.files[name]; ok {
		if start, end, ok := p.linesOf(name).span(r); ok {
			return consistencySpan{name, start, end}
		}
	}
	return consistencySpan{fmt.Sprintf("%s@%d:%d-%d:%d", uri, r.Start.Line, r.Start.Character, r.End.Line, r.End.Character), -1, -1}
}

// consistencyRequest runs one request within the hang limit, reports a
// panic as a crash and a failed request as a gap (LSP 3.17 and D61: a parsed
// document supports its requests), and checks that each range of the
// response lies inside its document, as FuzzEditor does.
func consistencyRequest[T any](c *consistency, p *consistencyProject, what string, document lsproto.DocumentUri, fn func(*ls.LanguageService) (T, error)) (T, bool) {
	c.t.Helper()
	var response T
	var err error
	toolsRun(c.t, consistencyTarget, what, c.archive+"\nat "+c.where, nil, func() { response, err = fn(p.service) })
	if err != nil {
		if toolsSyntaxError(c.main, p.files[c.main]) == "" {
			Gap(c.t, consistencyTarget, "consistency:request:"+strings.ReplaceAll(what, " ", "-"), "LSP 3.17, D61: %s failed at %s: %v\n%s", what, c.where, err, c.archive)
		}
		return response, false
	}
	read := func(uri lsproto.DocumentUri) (string, bool) {
		if uri == "" {
			return "", false // the response names its documents itself
		}
		return p.service.ReadFile(uri.FileName())
	}
	if bad := toolsBadRanges(response, document, read); len(bad) > 0 {
		Gap(c.t, consistencyTarget, "consistency:range:"+strings.ReplaceAll(what, " ", "-"), "LSP 3.17: %s at %s returns ranges outside their documents:\n%s\n%s", what, c.where, strings.Join(bad, "\n"), c.archive)
	}
	return response, true
}

func (c *consistency) check(offsets []byte) {
	text := c.files()[c.main]
	var positions []int
	for i := 0; i+1 < len(offsets) && len(positions) < consistencyPositions; i += 2 {
		positions = append(positions, toolsRuneStart(text, (int(offsets[i])<<8|int(offsets[i+1]))%(len(text)+1)))
	}
	symbols := c.symbols()
	for _, probe := range c.choose(symbols, positions) {
		refs := c.checkReferences(probe)
		if refs != nil {
			c.checkRename(probe, refs)
		}
	}
	c.checkOrganizeImports()
	c.checkCallHierarchy()
	c.checkSymbols()
	c.checkSelectionRanges(append(positions, consistencyOffsets(symbols)...))
}

func (c *consistency) files() map[string]string { return c.before.files }

// A consistencySymbol is a symbol declared in the project and referenced in
// the main file, with its references there.
type consistencySymbol struct {
	name        string
	kind        string // the kinds of its declarations, such as "FunctionDeclaration" or "TypeAliasDeclaration+VariableDeclaration"
	declaration *ast.Node
	ambient     bool // declared in a declaration file
	refs        []consistencyRef
}

// A consistencyRef is an identifier of the main file that names a symbol,
// directly or through an alias, as it is written.
type consistencyRef struct {
	start, end int
	identity   *ast.Node // the first declaration of the symbol or alias it names in its scope
	alias      bool      // it names an alias, such as an import, of the symbol
}

// merged reports whether the symbol has declarations of more than one kind,
// such as a constant and a type of the same name. TypeScript's references
// at such a name are those of the meaning the position has, a value's or a
// type's (FindAllReferences' getIntersectingMeaningFromDeclarations), while
// its definition and its rename take every declaration, so the relations
// between them hold only for a symbol of one kind.
func (s *consistencySymbol) merged() bool { return strings.Contains(s.kind, "+") }

// A consistencyProbe is a symbol and the reference at which it is asked.
type consistencyProbe struct {
	*consistencySymbol
	consistencyRef
}

// consistencyUnstable are the symbols whose references TypeScript itself
// resolves through types rather than through declarations: a property or
// method reached through a union or a contextual type finds every
// declaration it could be, so the reference sets asked at two of its
// references can differ. The relations of this target are TypeScript's on
// symbols that scopes declare, so it leaves members out.
const consistencyUnstable = ast.SymbolFlagsProperty | ast.SymbolFlagsMethod | ast.SymbolFlagsGetAccessor | ast.SymbolFlagsSetAccessor |
	ast.SymbolFlagsEnumMember | ast.SymbolFlagsSignature | ast.SymbolFlagsTypeLiteral | ast.SymbolFlagsObjectLiteral |
	ast.SymbolFlagsPrototype | ast.SymbolFlagsTransient

// consistencyTwoSymbols reports whether an identifier names two symbols at
// once: `x` in the shorthand `{ x }` and in the binding `{ x }` of an object
// pattern is a variable and a property. TypeScript's references and
// definition there take both, the property's from the contextual type too,
// so the relations of one symbol are not asked there.
func consistencyTwoSymbols(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil || parent.Name() != node {
		return false
	}
	return parent.Kind == ast.KindShorthandPropertyAssignment ||
		parent.Kind == ast.KindBindingElement && parent.PropertyName() == nil && parent.Parent != nil && parent.Parent.Kind == ast.KindObjectBindingPattern
}

// symbols returns the symbols the project declares that the main file
// references by an identifier written in its text, in the order of their
// first reference. A reference counts when its text is the name of what it
// names, so that a reference TypeScript resolves without naming the symbol,
// such as `target` in `new.target`, does not; and when it names one symbol.
// An empty identifier inserted by parser recovery has no written reference.
// A receiver parameter named `this` is not an ordinary binding: upstream's
// fourslash TestRenameThis allows its rename, but that turns an erased
// receiver into a runtime parameter and can change call arity. It is not the
// meaning-preserving alpha rename checkRename requires (D372).
func (c *consistency) symbols() []*consistencySymbol {
	r := c.before.r
	checker, done := r.Program.GetTypeChecker(c.ctx)
	defer done()
	text := c.files()[c.main]
	prefix := filepath.ToSlash(r.Dir) + "/"
	bySymbol := map[*ast.Symbol]*consistencySymbol{}
	var symbols []*consistencySymbol
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindIdentifier && node.Parent != nil && !consistencyTwoSymbols(node) && !ast.NodeIsMissing(node) && node.Text() != "this" {
			start := node.End() - len(node.Text())
			if start >= 0 && node.End() <= len(text) && text[start:node.End()] == node.Text() {
				if symbol := checker.GetSymbolAtLocation(node); symbol != nil && symbol.Name() == node.Text() && len(symbol.Declarations()) > 0 {
					if resolved := checker.SkipAlias(symbol); resolved != nil && resolved.Flags()&consistencyUnstable == 0 {
						var kinds []string
						ambient := false
						for _, declaration := range resolved.Declarations() {
							if file := ast.GetSourceFileOfNode(declaration); file != nil {
								if _, own := c.files()[strings.TrimPrefix(file.FileName().AsString(), prefix)]; own {
									if kind := strings.TrimPrefix(declaration.Kind.String(), "Kind"); !slices.Contains(kinds, kind) {
										kinds = append(kinds, kind)
									}
									ambient = ambient || file.IsDeclarationFile
								}
							}
						}
						slices.Sort(kinds)
						kind := strings.Join(kinds, "+")
						if kind != "" {
							s := bySymbol[resolved]
							if s == nil {
								s = &consistencySymbol{name: resolved.Name(), kind: kind, declaration: resolved.Declarations()[0], ambient: ambient}
								bySymbol[resolved] = s
								symbols = append(symbols, s)
							}
							if !slices.ContainsFunc(s.refs, func(ref consistencyRef) bool { return ref.start == start }) {
								s.refs = append(s.refs, consistencyRef{start, node.End(), symbol.Declarations()[0], symbol != resolved})
							}
						}
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	r.SourceFile(c.main).AsNode().ForEachChild(visit)
	return symbols
}

// choose returns the symbols to probe: for each position, the first symbol
// referenced at or after it, asked at that reference; the first symbol when
// there are no positions.
func (c *consistency) choose(symbols []*consistencySymbol, positions []int) []consistencyProbe {
	if len(symbols) == 0 {
		return nil
	}
	if len(positions) == 0 {
		return []consistencyProbe{{symbols[0], symbols[0].refs[0]}}
	}
	var probes []consistencyProbe
	for _, position := range positions {
		best := consistencyProbe{symbols[0], symbols[0].refs[0]}
		found := false
		for _, s := range symbols {
			for _, ref := range s.refs {
				if ref.start >= position && (!found || ref.start < best.start) {
					best, found = consistencyProbe{s, ref}, true
				}
			}
		}
		if !slices.ContainsFunc(probes, func(p consistencyProbe) bool { return p.consistencySymbol == best.consistencySymbol }) {
			probes = append(probes, best)
		}
		if len(probes) == consistencySymbols {
			break
		}
	}
	return probes
}

// consistencyOffsets returns the first reference of each symbol, for the
// selection range positions.
func consistencyOffsets(symbols []*consistencySymbol) []int {
	var offsets []int
	for _, s := range symbols {
		if len(offsets) == consistencyPositions {
			break
		}
		offsets = append(offsets, s.refs[0].start)
	}
	return offsets
}

// denotes returns, for each span, the first declaration of the symbol or
// alias its identifier names in its scope, or nil for a span that is no
// identifier, names nothing, or names two symbols (consistencyTwoSymbols).
// A declaration node is the same in every checker of a program, where a
// merged symbol may not be.
func (p *consistencyProject) denotes(ctx context.Context, spans []consistencySpan) []*ast.Node {
	checker, done := p.r.Program.GetTypeChecker(ctx)
	defer done()
	declarations := make([]*ast.Node, len(spans))
	for i, s := range spans {
		node := p.nodeAt(s.file, s.start)
		if node == nil || !ast.IsIdentifier(node) || consistencyTwoSymbols(node) {
			continue
		}
		if symbol := checker.GetSymbolAtLocation(node); symbol != nil && len(symbol.Declarations()) > 0 {
			declarations[i] = symbol.Declarations()[0]
		}
	}
	return declarations
}

// references returns the references of the symbol at a byte offset of a
// project file, its declarations included (LSP 3.17, ReferenceContext:
// "Include the declaration of the current symbol").
func (c *consistency) references(p *consistencyProject, name string, offset int) (map[consistencySpan]bool, bool) {
	uri := p.uri(name)
	response, ok := consistencyRequest(c, p, "references", uri, func(s *ls.LanguageService) (lsproto.ReferencesResponse, error) {
		return s.ProvideReferences(c.ctx, &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: p.position(name, offset), Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
	})
	if !ok {
		return nil, false
	}
	refs := map[consistencySpan]bool{}
	if response.Locations != nil {
		for _, location := range *response.Locations {
			refs[p.span(location.Uri, location.Range)] = true
		}
	}
	return refs, true
}

// definitions returns where go-to-definition at a byte offset of a project
// file leads.
func (c *consistency) definitions(p *consistencyProject, name string, offset int) (map[consistencySpan]bool, bool) {
	uri := p.uri(name)
	response, ok := consistencyRequest(c, p, "definition", uri, func(s *ls.LanguageService) (lsproto.DefinitionResponse, error) {
		return s.ProvideDefinition(c.ctx, uri, p.position(name, offset))
	})
	if !ok {
		return nil, false
	}
	defs := map[consistencySpan]bool{}
	if response.Location != nil {
		defs[p.span(response.Location.Uri, response.Location.Range)] = true
	}
	if response.Locations != nil {
		for _, location := range *response.Locations {
			defs[p.span(location.Uri, location.Range)] = true
		}
	}
	if response.DefinitionLinks != nil {
		for _, link := range *response.DefinitionLinks {
			defs[p.span(link.TargetUri, link.TargetSelectionRange)] = true
		}
	}
	return defs, true
}

// highlights returns the document highlights at a byte offset of a project
// file.
func (c *consistency) highlights(p *consistencyProject, name string, offset int) (map[consistencySpan]bool, bool) {
	uri := p.uri(name)
	response, ok := consistencyRequest(c, p, "document highlights", uri, func(s *ls.LanguageService) (lsproto.DocumentHighlightResponse, error) {
		return s.ProvideDocumentHighlights(c.ctx, uri, p.position(name, offset))
	})
	if !ok {
		return nil, false
	}
	spans := map[consistencySpan]bool{}
	if response.DocumentHighlights != nil {
		for _, highlight := range *response.DocumentHighlights {
			spans[p.span(uri, highlight.Range)] = true
		}
	}
	return spans, true
}

// consistencyDiff describes how two sets of spans differ, or returns "".
func consistencyDiff(want, got map[consistencySpan]bool) string {
	var missing, extra []string
	for s := range want {
		if !got[s] {
			missing = append(missing, s.String())
		}
	}
	for s := range got {
		if !want[s] {
			extra = append(extra, s.String())
		}
	}
	if len(missing) == 0 && len(extra) == 0 {
		return ""
	}
	slices.Sort(missing)
	slices.Sort(extra)
	return fmt.Sprintf("missing %v, extra %v", missing, extra)
}

// consistencySorted returns spans in a stable order: the project's spans by
// file and offset, then other documents'.
func consistencySorted(spans map[consistencySpan]bool) []consistencySpan {
	sorted := make([]consistencySpan, 0, len(spans))
	for s := range spans {
		sorted = append(sorted, s)
	}
	slices.SortFunc(sorted, func(a, b consistencySpan) int {
		if a.inProject() != b.inProject() {
			if a.inProject() {
				return -1
			}
			return 1
		}
		if c := strings.Compare(a.file, b.file); c != 0 {
			return c
		}
		if a.start != b.start {
			return a.start - b.start
		}
		return a.end - b.end
	})
	return sorted
}

// consistencySpread returns at most n spans spread evenly over sorted.
func consistencySpread(sorted []consistencySpan, n int) []consistencySpan {
	if len(sorted) <= n {
		return sorted
	}
	var spread []consistencySpan
	for i := range n {
		spread = append(spread, sorted[i*len(sorted)/n])
	}
	return spread
}

// nodeAt returns the identifier or other token at a byte offset of a project
// file in p's program.
func (p *consistencyProject) nodeAt(name string, offset int) *ast.Node {
	file := p.r.SourceFile(name)
	if file == nil {
		return nil
	}
	return astnav.GetTouchingPropertyName(file, offset)
}

// kindOfRange names the innermost node of a project file that holds the
// bytes [start, end), such as "TypeReference", for a gap's key.
func (p *consistencyProject) kindOfRange(name string, start, end int) string {
	file := p.r.SourceFile(name)
	if file == nil {
		return "none"
	}
	for node := astnav.GetTokenAtPosition(file, start); node != nil; node = node.Parent {
		if node.End() >= end {
			return strings.TrimPrefix(node.Kind.String(), "Kind")
		}
	}
	return "none"
}

// consistencyCallTarget reports whether an identifier is the callee of a
// call, new expression, tagged template or decorator, or the right operand
// of instanceof, which TypeScript resolves as a call of its
// [Symbol.hasInstance]. There TypeScript's go-to-definition goes to the
// signature the call resolves to, such as a class's constructor or one
// overload, as well as or instead of the symbol's declarations
// (getDefinitionAtPosition's tryGetSignatureDeclaration).
func consistencyCallTarget(node *ast.Node) bool {
	if node == nil {
		return true
	}
	parent := node.Parent
	return ast.IsCallOrNewExpressionTarget(node, true, true) || ast.IsTaggedTemplateTag(node, true, true) || ast.IsDecoratorTarget(node, true, true) ||
		parent != nil && (ast.IsJsxOpeningLikeElement(parent) || parent.Kind == ast.KindJsxClosingElement ||
			parent.Kind == ast.KindBinaryExpression && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword && parent.AsBinaryExpression().Right == node)
}

// checkReferences checks the references of a probed symbol and returns them,
// or nil when the request failed.
//
// LSP 3.17's textDocument/references resolves "project-wide references for
// the symbol denoted by the given text document position", and its
// ReferenceContext.includeDeclaration includes "the declaration of the
// current symbol". The set depends on the symbol, not on the position that
// denotes it. TypeScript's FindAllReferences searches by symbol and follows
// an import or export to the symbol it names, except one that renames it
// (`a as b`) or a namespace import, whose references are its own; so the
// relations are asked among the references that name the same symbol or
// alias as the probed one (its identity):
//
//   - The set holds the reference asked at. Unless the probed name is an
//     alias, it holds the declarations go-to-definition (textDocument/
//     definition, "the definition location of a symbol") finds.
//   - Asking at each other reference of the same identity gives the same
//     set. consistencyUnstable leaves out the members TypeScript searches
//     by type, and consistencyTwoSymbols the names that are two symbols.
//   - Go-to-definition at each such reference that is not a callee
//     (consistencyCallTarget) gives the same declarations: TypeScript's
//     getDefinitionFromSymbol returns the symbol's declarations wherever it
//     is denoted.
//   - Document highlights at such a reference are references in its file,
//     and include every reference of the same identity there: LSP 3.17 says
//     a highlight "usually highlights all references to the symbol scoped
//     to this file", and TypeScript's getDocumentHighlights is
//     FindAllReferences restricted to the file, which does not reach
//     another import of the same export through the exporting file.
//
// A .vibe file is read as its Effect TypeScript (SKILL.md), so the same
// relations hold there (D32, D61). Only the first holds for a merged symbol
// (consistencySymbol.merged).
func (c *consistency) checkReferences(probe consistencyProbe) map[consistencySpan]bool {
	p := c.before
	key := probe.kind
	position := p.position(c.main, probe.start)
	c.where = fmt.Sprintf("%s %q at %d:%d (byte %d)", probe.kind, probe.name, position.Line, position.Character, probe.start)
	refs, ok := c.references(p, c.main, probe.start)
	if !ok {
		return nil
	}
	self := consistencySpan{c.main, probe.start, probe.end}
	if !refs[self] {
		Gap(c.t, consistencyTarget, "consistency:references:self:"+key, "LSP 3.17: the references of %s do not include it: %v\n%s", c.where, consistencySorted(refs), c.archive)
	}
	if probe.merged() {
		return refs
	}
	sorted := consistencySorted(refs)
	var same []consistencySpan
	for i, identity := range p.denotes(c.ctx, sorted) {
		if identity != nil && identity == probe.identity {
			same = append(same, sorted[i])
		}
	}
	// The declarations of the symbol, as go-to-definition finds them at a
	// reference that is no callee.
	var defs map[consistencySpan]bool
	for _, ref := range same {
		if !consistencyCallTarget(p.nodeAt(ref.file, ref.start)) {
			if defs, ok = c.definitions(p, ref.file, ref.start); !ok {
				return refs
			}
			break
		}
	}
	if !probe.alias {
		for def := range defs {
			if def.inProject() && !refs[def] {
				Gap(c.t, consistencyTarget, "consistency:definition:not-a-reference:"+key, "LSP 3.17: the definition %s of %s is not among its references %v\n%s", def, c.where, sorted, c.archive)
			}
		}
	}
	for _, ref := range consistencySpread(same, consistencyReferences) {
		node := p.nodeAt(ref.file, ref.start)
		at := p.position(ref.file, ref.start)
		c.where = fmt.Sprintf("%s %q's reference %s:%d:%d (byte %d), asked from byte %d", probe.kind, probe.name, ref.file, at.Line, at.Character, ref.start, probe.start)
		parent := "none"
		if node != nil && node.Parent != nil {
			parent = strings.TrimPrefix(node.Parent.Kind.String(), "Kind")
		}
		if other, ok := c.references(p, ref.file, ref.start); ok {
			if diff := consistencyDiff(refs, other); diff != "" {
				Gap(c.t, consistencyTarget, "consistency:references:asymmetric:"+key+":"+parent, "LSP 3.17: the references at %s differ from those at the probed reference: %s\n%s", c.where, diff, c.archive)
			}
		}
		if defs != nil && !consistencyCallTarget(node) {
			if other, ok := c.definitions(p, ref.file, ref.start); ok {
				if diff := consistencyDiff(defs, other); diff != "" {
					Gap(c.t, consistencyTarget, "consistency:definition:differs:"+key+":"+parent, "LSP 3.17: go-to-definition at %s differs from the symbol's declarations: %s\n%s", c.where, diff, c.archive)
				}
			}
		}
		if highlights, ok := c.highlights(p, ref.file, ref.start); ok {
			var problems []string
			for s := range highlights {
				if !refs[s] {
					problems = append(problems, "the highlight "+s.String()+" is no reference")
				}
			}
			for _, s := range same {
				if s.file == ref.file && !highlights[s] {
					problems = append(problems, "the reference "+s.String()+" is not highlighted")
				}
			}
			if len(problems) > 0 {
				slices.Sort(problems)
				Gap(c.t, consistencyTarget, "consistency:highlights:"+key+":"+parent, "LSP 3.17: the document highlights at %s are not the references in %s: %s\n%s", c.where, ref.file, strings.Join(problems, "; "), c.archive)
			}
		}
	}
	return refs
}

// checkSelectionRanges asks for the selection ranges at positions of the main
// file. LSP 3.17's textDocument/selectionRange answers "for the position in
// the provided parameters at the same index. Therefore positions[i] must be
// contained in result[i].range", and of each SelectionRange "The parent
// selection range containing this range. Therefore `parent.range` must
// contain `this.range`."
func (c *consistency) checkSelectionRanges(offsets []int) {
	if len(offsets) == 0 {
		return
	}
	p := c.before
	uri := p.uri(c.main)
	var positions []lsproto.Position
	for _, offset := range offsets {
		positions = append(positions, p.position(c.main, offset))
	}
	c.where = fmt.Sprintf("bytes %v", offsets)
	response, ok := consistencyRequest(c, p, "selection ranges", uri, func(s *ls.LanguageService) (lsproto.SelectionRangeResponse, error) {
		return s.ProvideSelectionRanges(c.ctx, &lsproto.SelectionRangeParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Positions: positions})
	})
	if !ok || response.SelectionRanges == nil {
		return
	}
	ranges := *response.SelectionRanges
	if len(ranges) != len(positions) {
		Gap(c.t, consistencyTarget, "consistency:selection-ranges:count", "LSP 3.17: %d selection ranges for %d positions at %s\n%s", len(ranges), len(positions), c.where, c.archive)
		return
	}
	lines := p.linesOf(c.main)
	for i, selection := range ranges {
		offset := offsets[i]
		at := fmt.Sprintf("byte %d (%d:%d)", offset, positions[i].Line, positions[i].Character)
		start, end, ok := lines.span(selection.Range)
		if !ok {
			continue // FuzzEditor's range oracle reports it
		}
		if offset < start || offset > end {
			Gap(c.t, consistencyTarget, "consistency:selection-ranges:position", "LSP 3.17: the selection range [%d, %d) does not contain its position %s\n%s", start, end, at, c.archive)
		}
		for child := selection; child.Parent != nil; child = child.Parent {
			parentStart, parentEnd, ok1 := lines.span(child.Parent.Range)
			childStart, childEnd, ok2 := lines.span(child.Range)
			if ok1 && ok2 && (parentStart > childStart || childEnd > parentEnd) {
				kind := p.kindOfRange(c.main, childStart, childEnd) + "-in-" + p.kindOfRange(c.main, parentStart, parentEnd)
				key := consistencySelectionNestingKey(c.main, p.files[c.main], min(childStart, parentStart), max(childEnd, parentEnd), kind)
				Gap(c.t, consistencyTarget, key, "LSP 3.17: at %s the selection range [%d, %d) %q is not inside its parent [%d, %d) %q\n%s", at, childStart, childEnd, p.files[c.main][childStart:childEnd], parentStart, parentEnd, p.files[c.main][parentStart:parentEnd], c.archive)
			}
		}
	}
}

// consistencySelectionNestingKey groups the source-order failures of nodes
// VibeLang forms synthesize (D32), independently of their TypeScript kinds.
// LSP 3.17 requires nesting for every form. Only ranges crossing a form's
// own syntax use the pending key; TypeScript elsewhere in the file, and in
// a form's body, keeps its strict key.
func consistencySelectionNestingKey(name, text string, start, end int, kind string) string {
	key := "consistency:selection-ranges:nesting:"
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/" + name), PathKey: tspath.PathKey("/" + name)}, text)
	touches := func(a, b int) bool { return a < b && start < b && a < end }
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxClause && form.Name == "catch" {
			continue // An ordinary TypeScript catch clause is recorded too.
		}
		if touches(form.Word.Pos(), form.Word.End()) || touches(form.Head.Pos(), form.Head.End()) {
			return key + "vibelang"
		}
		switch form.Kind {
		case parser.VibeSyntaxEffectType, parser.VibeSyntaxStatement:
			if touches(form.Range.Pos(), form.Range.End()) {
				return key + "vibelang"
			}
		case parser.VibeSyntaxDeclaration:
			if touches(form.Range.Pos(), form.Head.End()) { // Includes declaration modifiers.
				return key + "vibelang"
			}
		case parser.VibeSyntaxIs:
			if touches(form.Right.Pos(), form.Right.End()) {
				return key + "vibelang"
			}
		case parser.VibeSyntaxForConcurrent:
			// The recorded range ends before the binding and iterable, whose
			// selection nodes become an arrow and call arguments.
			depth := 0
			for _, token := range toolsScan(text[form.Head.End():]) {
				if token.kind == ast.KindOpenParenToken {
					depth++
				} else if token.kind == ast.KindCloseParenToken {
					depth--
					if depth == 0 {
						if touches(form.Head.End(), form.Head.End()+token.end) {
							return key + "vibelang"
						}
						break
					}
				}
			}
		}
		for _, arm := range form.Arms {
			if touches(arm.Head.Pos(), arm.Head.End()) {
				return key + "vibelang"
			}
		}
	}
	return key + kind
}

// TestConsistencySelectionNestingKey keeps the LSP nesting oracle strict
// for TypeScript syntax, even beside or inside a VibeLang form (D32).
func TestConsistencySelectionNestingKey(t *testing.T) {
	for _, test := range []struct {
		name, file, source, selection string
		vibe                          bool
	}{
		{"contract", "main.vibe", "type T = number!!", "number!!", true},
		{"declaration modifier", "main.vibe", "export data D { A }", "export", true},
		{"catch expression", "main.vibe", "const x = 0 catch 1", "0 catch 1", true},
		{"concurrent binding", "main.vibe", "for concurrent(1) (const x of []) {}", "x of []", true},
		{"typescript", "main.ts", "function f(x: number) { return x + 1 }", "x + 1", false},
		{"typescript sibling", "main.vibe", "type T = number!!; function f(x: number) { return x + 1 }", "x + 1", false},
		{"typescript inside form", "main.vibe", "const x = do { const n = 1 + 2; n }", "1 + 2", false},
		{"typescript catch", "main.vibe", "try {} catch (e) { const n = 1 + 2 }", "catch (e)", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			start := strings.Index(test.source, test.selection)
			want := "consistency:selection-ranges:nesting:BinaryExpression-in-Block"
			if test.vibe {
				want = "consistency:selection-ranges:nesting:vibelang"
			}
			if got := consistencySelectionNestingKey(test.file, test.source, start, start+len(test.selection), "BinaryExpression-in-Block"); got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
		})
	}
}
