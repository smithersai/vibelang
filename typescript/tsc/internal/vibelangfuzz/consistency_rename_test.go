package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// consistencyFreshName returns an identifier that no file of the project
// contains, so that a rename to it can neither capture nor shadow a name.
func consistencyFreshName(files map[string]string) string {
	for i := 0; ; i++ {
		name := fmt.Sprintf("fuzzFresh%d", i)
		if !slices.ContainsFunc(slices.Collect(maps.Values(files)), func(text string) bool { return strings.Contains(text, name) }) {
			return name
		}
	}
}

// consistencyEdited is a workspace edit applied to a project's files.
type consistencyEdited struct {
	files    map[string]string
	edits    map[string][]toolsEdit // by file, in the order of their start
	replaced []consistencySpan      // each edit's new text, in the edited files
	written  []consistencySpan      // each occurrence of the new name in the edits' new text
}

// apply applies a workspace edit to p's files. It reports an edit of a file
// outside the project or one LSP 3.17 does not allow (overlapping or outside
// its document), and returns false then.
func (c *consistency) apply(p *consistencyProject, what, key, name string, edit *lsproto.WorkspaceEdit) (*consistencyEdited, bool) {
	changes, ok := toolsWorkspaceEdits(edit)
	if !ok {
		return nil, false // a file creation, rename or deletion
	}
	result := &consistencyEdited{files: maps.Clone(p.files), edits: map[string][]toolsEdit{}}
	prefix := filepath.ToSlash(p.r.Dir) + "/"
	for uri, edits := range changes {
		file := strings.TrimPrefix(uri.FileName().AsString(), prefix)
		before, ok := p.files[file]
		if !ok {
			Gap(c.t, consistencyTarget, key+":outside-project", "%s at %s edits %s, outside the project\n%s", what, c.where, uri, c.archive)
			return nil, false
		}
		after, spans, err := toolsApply(before, edits)
		if err != nil {
			Gap(c.t, consistencyTarget, key+":edits", "LSP 3.17: %s at %s on %s: %v\n%s", what, c.where, file, err, c.archive)
			return nil, false
		}
		result.files[file] = after
		result.edits[file] = spans
		shift := 0
		for _, e := range spans {
			start := e.start + shift
			result.replaced = append(result.replaced, consistencySpan{file, start, start + len(e.text)})
			for i := 0; name != ""; {
				j := strings.Index(e.text[i:], name)
				if j < 0 {
					break
				}
				result.written = append(result.written, consistencySpan{file, start + i + j, start + i + j + len(name)})
				i += j + len(name)
			}
			shift += len(e.text) - (e.end - e.start)
		}
	}
	return result, true
}

// touches reports whether an edit of the span's file overlaps it.
func (e *consistencyEdited) touches(s consistencySpan) bool {
	return slices.ContainsFunc(e.edits[s.file], func(edit toolsEdit) bool {
		return s.start < edit.end && edit.start < s.end || edit.start == edit.end && s.start <= edit.start && edit.start <= s.end
	})
}

// mapped returns where an untouched span of the old files lies in the new.
func (e *consistencyEdited) mapped(s consistencySpan) consistencySpan {
	edits := e.edits[s.file]
	return consistencySpan{s.file, toolsMap(s.start, edits, true), toolsMap(s.end, edits, true)}
}

// inside reports whether a span of the new files lies inside one edit's new
// text.
func (e *consistencyEdited) inside(s consistencySpan) bool {
	return slices.ContainsFunc(e.replaced, func(r consistencySpan) bool {
		return r.file == s.file && r.start <= s.start && s.end <= r.end
	})
}

// consistencySpelled reports whether a project spells a name as a string
// literal. A rename to a fresh name changes such a program's meaning by the
// specification's design: an error's tag is its bare class name (SKILL.md
// rule 8, D278), so `catchTag("NotFound")` or `_tag === "NotFound"` stops
// matching a renamed `error NotFound`, where the Effect reading's
// Data.TaggedError("NotFound") keeps its tag. Such a rename's diagnostics
// are not compared.
func consistencySpelled(files map[string]string, name string) bool {
	for _, text := range files {
		for _, quote := range []string{`"`, `'`, "`"} {
			if strings.Contains(text, quote+name+quote) {
				return true
			}
		}
	}
	return false
}

// consistencyDidYouMean maps each TypeScript diagnostic that suggests a
// similar name to the one it is without a suggestion. A rename changes which
// names are similar, so a "Cannot find name 'x'. Did you mean 'y'?" may
// become a plain "Cannot find name 'x'." with no change of meaning.
var consistencyDidYouMean = map[int32]int32{2552: 2304, 2662: 2304, 2663: 2304, 2551: 2339, 2576: 2339, 2561: 2353, 2724: 2305, 2833: 2503}

// consistencyDiagnosticCounts counts a compilation's diagnostics by file,
// code and category. A rename or a moved import moves diagnostics and
// changes the names in their messages, so positions and messages are left
// out.
func consistencyDiagnosticCounts(r *Result, keep func(*ast.Diagnostic) bool) map[string]int {
	counts := map[string]int{}
	for _, d := range r.Diagnostics {
		if keep == nil || keep(d) {
			name := toolsFileCode(r, d)
			if base, ok := consistencyDidYouMean[d.Code()]; ok && d.Source() == "" {
				name = strings.TrimSuffix(name, fmt.Sprint(d.Code())) + fmt.Sprint(base)
			}
			counts[fmt.Sprintf("%s (category %d)", name, d.Category())]++
		}
	}
	return counts
}

// consistencyCountDiff returns the keys whose counts differ, as "key: n -> m",
// and the code of the first one, such as "EK9201", for a gap's key.
func consistencyCountDiff(before, after map[string]int, removedOnly bool) ([]string, string) {
	keys := slices.Sorted(maps.Keys(before))
	for key := range after {
		if _, ok := before[key]; !ok {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	var diff []string
	first := ""
	for _, key := range keys {
		if before[key] == after[key] || removedOnly && after[key] > before[key] {
			continue
		}
		diff = append(diff, fmt.Sprintf("%s: %d -> %d", key, before[key], after[key]))
		if first == "" {
			first = strings.Fields(key[strings.Index(key, ": ")+2:])[0]
		}
	}
	return diff, first
}

// checkRename renames a probed symbol to a fresh name and checks the result.
//
// LSP 3.17's textDocument/rename computes "a workspace-wide rename of a
// symbol". A rename to a name no file contains changes which name the
// symbol has and nothing else: under TypeScript's semantics on the Effect
// reading (D32) it keeps the program, and Chapter 28 ("Rewrites keep
// meaning", D372) requires that every automatic change, "a refactor applied
// without a choice" among them, keeps the program's meaning, and checks that
// it "reports no new error". So:
//
//   - Each edit replaces a reference of the symbol.
//   - The renamed program reports the same diagnostics by file, code and
//     category.
//   - The new name's references are the old name's, mapped through the edit:
//     each place the edit wrote the new name is a reference of it, each of its
//     references is inside an edit or is an old reference the edit left as
//     it was, and each such old reference is still one. This compares the
//     server with itself on two programs that the rename makes the same
//     program (metamorphic). An edit that writes more than the name, such as
//     `a as fresh` for an import or `x: fresh` for a shorthand property,
//     makes the new name an alias whose references TypeScript keeps apart
//     from the old symbol's, so the last relation needs edits that write only
//     the name.
//
// A rename of a merged symbol (consistencySymbol.merged) edits every
// declaration while its references are one meaning's, so only its
// diagnostics are compared. Left out are a project with a syntax error, since
// D372 speaks of programs and a parser's recovery may read the renamed text
// another way; a symbol a declaration file declares, which describes code
// outside the program that a rename does not change; and `main`, whose name
// makes a function the program's entry (SKILL.md's Forms, D312).
// symbols also leaves out a `this` receiver: renaming it changes its special
// parameter semantics even in stock TypeScript (TestConsistencyThisParameter).
func (c *consistency) checkRename(probe consistencyProbe, refs map[consistencySpan]bool) {
	p := c.before
	if !c.parses(p) || probe.ambient || probe.name == "main" {
		return
	}
	old := p.files[c.main][probe.start:probe.end]
	name := consistencyFreshName(p.files)
	uri := p.uri(c.main)
	position := p.position(c.main, probe.start)
	c.where = fmt.Sprintf("%s %q at %d:%d (byte %d), renamed to %s", probe.kind, probe.name, position.Line, position.Character, probe.start, name)
	response, ok := consistencyRequest(c, p, "rename", uri, func(s *ls.LanguageService) (lsproto.RenameResponse, error) {
		return s.ProvideRename(c.ctx, &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: position, NewName: name}, nil)
	})
	if !ok || response.WorkspaceEdit == nil {
		return
	}
	key := "consistency:rename:" + probe.kind
	edited, ok := c.apply(p, "the rename", key, name, response.WorkspaceEdit)
	if !ok || len(edited.edits) == 0 {
		return
	}
	aliased := false
	for file, edits := range edited.edits {
		for _, e := range edits {
			aliased = aliased || e.text != name
			if replaced := (consistencySpan{file, e.start, e.end}); !refs[replaced] && !probe.merged() {
				Gap(c.t, consistencyTarget, key+":edit-not-a-reference", "LSP 3.17: the rename at %s replaces %s %q, which is not among the symbol's references %v\n%s", c.where, replaced, p.files[file][e.start:e.end], consistencySorted(refs), c.archive)
			}
		}
	}
	if len(edited.written) == 0 {
		Gap(c.t, consistencyTarget, key+":no-new-name", "LSP 3.17: the rename at %s writes the new name nowhere\n%s", c.where, c.archive)
		return
	}
	after := toolsCompile(c.t, c.w, consistencyTarget, edited.files)
	defer after.Remove()
	if diff, code := consistencyCountDiff(consistencyDiagnosticCounts(p.r, nil), consistencyDiagnosticCounts(after, nil), false); len(diff) > 0 && !consistencySpelled(p.files, old) {
		Gap(c.t, consistencyTarget, key+":diagnostics:"+code, "D372: the rename at %s changes the diagnostics:\n%s\n%s\nrenamed:\n%s", c.where, strings.Join(diff, "\n"), c.archive, Archive(edited.files))
	}
	if after.SourceFile(c.main) == nil || probe.merged() {
		return
	}
	q := c.project(after, edited.files)
	written := slices.Clone(edited.written)
	slices.SortStableFunc(written, func(a, b consistencySpan) int {
		if (a.file == c.main) != (b.file == c.main) {
			if a.file == c.main {
				return -1
			}
			return 1
		}
		return 0
	})
	at := written[0]
	newRefs, ok := c.references(q, at.file, at.start)
	if !ok {
		return
	}
	// The old references the edit left as they were, where they are now, and
	// whether each is spelled as the old name.
	untouched := map[consistencySpan]bool{}
	for ref := range refs {
		if ref.inProject() && !edited.touches(ref) {
			untouched[edited.mapped(ref)] = p.files[ref.file][ref.start:ref.end] == old
		}
	}
	for _, w := range edited.written {
		if !newRefs[w] {
			Gap(c.t, consistencyTarget, key+":written-not-a-reference", "LSP 3.17: the rename at %s writes %s at %s, which is not among the references %v of the new name at %s\n%s\nrenamed:\n%s", c.where, name, w, consistencySorted(newRefs), at, c.archive, Archive(edited.files))
		}
	}
	for ref := range newRefs {
		if _, was := untouched[ref]; ref.inProject() && !was && !edited.inside(ref) {
			Gap(c.t, consistencyTarget, key+":new-reference", "LSP 3.17: after the rename at %s, %s %q is a reference of the new name but was no reference of the old\n%s\nrenamed:\n%s", c.where, ref, q.files[ref.file][ref.start:ref.end], c.archive, Archive(edited.files))
		}
	}
	for ref, named := range untouched {
		// An untouched reference spelled otherwise, such as `default`, is
		// another name of the symbol, an alias as `as` makes one.
		if named && !aliased && !newRefs[ref] {
			Gap(c.t, consistencyTarget, key+":lost-reference", "LSP 3.17: after the rename at %s, %s %q, a reference the rename left as it was, is no longer a reference of the symbol\n%s\nrenamed:\n%s", c.where, ref, q.files[ref.file][ref.start:ref.end], c.archive, Archive(edited.files))
		}
	}
}

// parses reports whether every source file of p parses without a syntax
// error.
func (c *consistency) parses(p *consistencyProject) bool {
	for name, text := range p.files {
		if isSource(name) && toolsSyntaxError(name, text) != "" {
			return false
		}
	}
	return true
}

// organizeImports returns the main file's edits of p's "Organize Imports"
// source action (LSP 3.17, CodeActionKind "source.organizeImports").
func (c *consistency) organizeImports(p *consistencyProject) ([]*lsproto.TextEdit, bool) {
	uri := p.uri(c.main)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindSourceOrganizeImports}
	response, ok := consistencyRequest(c, p, "organize imports", uri, func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
		return s.ProvideCodeActions(c.ctx, &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}, Only: &only}})
	})
	if !ok || response.CommandOrCodeActionArray == nil {
		return nil, ok
	}
	var edits []*lsproto.TextEdit
	for _, action := range *response.CommandOrCodeActionArray {
		if action.CodeAction == nil || action.CodeAction.Kind == nil || *action.CodeAction.Kind != lsproto.CodeActionKindSourceOrganizeImportsTs || action.CodeAction.Edit == nil {
			continue
		}
		changes, ok := toolsWorkspaceEdits(action.CodeAction.Edit)
		if !ok {
			continue
		}
		for other, more := range changes {
			if other != uri && len(more) > 0 {
				Gap(c.t, consistencyTarget, "consistency:organize-imports:other-file", "organize imports of %s edits %s\n%s", c.main, other, c.archive)
			}
		}
		edits = append(edits, changes[uri]...)
	}
	return edits, true
}

// checkOrganizeImports applies the main file's "Organize Imports" and checks
// it as Chapter 28's "Rewrites keep meaning" (D372) checks every automatic
// change: the file still parses, the program "reports no new error", and
// "Applying a fix or the formatter a second time changes nothing". Removing
// an unused import removes the diagnostics reported at it, such as an unused
// declaration's, so only the diagnostics outside the rewritten imports must
// stay, by file, code and category. A project with a syntax error is left
// out, as checkRename leaves it out.
func (c *consistency) checkOrganizeImports() {
	p := c.before
	if !c.parses(p) {
		return
	}
	c.where = "organize imports of " + c.main
	edits, ok := c.organizeImports(p)
	if !ok || len(edits) == 0 {
		return
	}
	before := p.files[c.main]
	after, spans, err := toolsApply(before, edits)
	if err != nil {
		Gap(c.t, consistencyTarget, "consistency:organize-imports:edits", "LSP 3.17: %s: %v\n%s", c.where, err, c.archive)
		return
	}
	if after == before {
		return
	}
	if toolsSyntaxError(c.main, before) == "" {
		if syntax := toolsSyntaxError(c.main, after); syntax != "" {
			Gap(c.t, consistencyTarget, "consistency:organize-imports:parse", "D372: %s leaves a syntax error (%s)\n%s\norganized:\n%s", c.where, syntax, c.archive, after)
			return
		}
	}
	files := maps.Clone(p.files)
	files[c.main] = after
	organized := toolsCompile(c.t, c.w, consistencyTarget, files)
	defer organized.Remove()
	if added := toolsAddedErrors(p.r, organized); len(added) > 0 {
		code := strings.Fields(added[0][strings.Index(added[0], ": ")+2:])[0]
		Gap(c.t, consistencyTarget, "consistency:organize-imports:error:"+code, "D372: %s adds errors: %s\n%s\norganized:\n%s", c.where, strings.Join(added, "\n"), c.archive, after)
	}
	main := p.r.SourceFile(c.main)
	outside := func(d *ast.Diagnostic) bool {
		return d.File() != main || main == nil || !slices.ContainsFunc(spans, func(e toolsEdit) bool {
			return d.Pos() < e.end && e.start < d.End() || d.Pos() == d.End() && e.start <= d.Pos() && d.Pos() <= e.end
		})
	}
	if diff, code := consistencyCountDiff(consistencyDiagnosticCounts(p.r, outside), consistencyDiagnosticCounts(organized, nil), true); len(diff) > 0 {
		Gap(c.t, consistencyTarget, "consistency:organize-imports:removed:"+code, "D372: %s removes diagnostics outside the imports it rewrites:\n%s\n%s\norganized:\n%s", c.where, strings.Join(diff, "\n"), c.archive, after)
	}
	if organized.SourceFile(c.main) == nil {
		return
	}
	q := c.project(organized, files)
	c.where = "organize imports, a second time, of " + c.main
	second, ok := c.organizeImports(q)
	if !ok || len(second) == 0 {
		return
	}
	if again, _, err := toolsApply(after, second); err != nil {
		Gap(c.t, consistencyTarget, "consistency:organize-imports:edits", "LSP 3.17: %s: %v\n%s\norganized:\n%s", c.where, err, c.archive, after)
	} else if again != after {
		Gap(c.t, consistencyTarget, "consistency:organize-imports:idempotent", "D372: %s changes the file again\n%s\norganized once:\n%s\ntwice:\n%s", c.where, c.archive, after, again)
	}
}

// TestConsistencyThisParameter pins why the D372 alpha-rename oracle cannot
// include an erased `this` receiver. Upstream's fourslash TestRenameThis
// permits the rename. Stock TypeScript 7.1.0-beta's language service also
// renames both occurrences below, making f.call(1) report TS2554 because f
// now takes a runtime argument. This test checks that semantic distinction
// and that ordinary parameters still reach the oracle.
func TestConsistencyThisParameter(t *testing.T) {
	w := NewWorkspace(t)
	files := map[string]string{"main.ts": "function f(this: number, n = 0) { return this + n }\nf.call(1)\n"}
	r := toolsCompile(t, w, consistencyTarget, files)
	defer r.Remove()
	if HasError(r.Diagnostics) {
		t.Fatalf("the receiver example must type-check: %v", Keys(r.Dir, r.Diagnostics))
	}
	c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.ts", archive: Archive(files)}
	p := c.project(r, files)
	c.before = p
	symbols := c.symbols()
	if slices.ContainsFunc(symbols, func(s *consistencySymbol) bool { return s.name == "this" }) {
		t.Fatal("a special receiver reached the meaning-preserving rename oracle")
	}
	if !slices.ContainsFunc(symbols, func(s *consistencySymbol) bool { return s.name == "n" }) {
		t.Fatal("an ordinary parameter did not reach the rename oracle")
	}
	response, err := p.service.ProvideRename(t.Context(), &lsproto.RenameParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: p.uri(c.main)},
		Position:     p.position(c.main, strings.Index(files[c.main], "this")), NewName: "receiver",
	}, nil)
	if err != nil || response.WorkspaceEdit == nil {
		t.Fatalf("TypeScript permits renaming the receiver: response %v, error %v", response, err)
	}
	edited, ok := c.apply(p, "receiver rename", "consistency:rename:Parameter", "receiver", response.WorkspaceEdit)
	if !ok || !strings.Contains(edited.files[c.main], "f(receiver: number, n = 0) { return receiver + n }") {
		t.Fatalf("the rename must turn the receiver into an ordinary parameter: %v", edited)
	}
	after := toolsCompile(t, w, consistencyTarget, edited.files)
	defer after.Remove()
	if !slices.ContainsFunc(after.Diagnostics, func(d *ast.Diagnostic) bool { return d.Source() == "" && d.Code() == 2554 }) {
		t.Fatalf("the changed call arity must report TS2554: %v", Keys(after.Dir, after.Diagnostics))
	}
}
