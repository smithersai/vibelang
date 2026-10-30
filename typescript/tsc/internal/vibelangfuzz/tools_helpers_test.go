package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// TestToolsHelpers checks the tools area's helpers on inputs whose answer
// is known, so that an oracle built on them cannot pass vacuously.
func TestToolsHelpers(t *testing.T) {
	// LSP 3.17 positions: "\r\n" and "\r" end lines, and an astral
	// character is two UTF-16 code units.
	lines := newToolsLines("a\r\nb😀c\rd\n")
	if got := lines.position(strings.Index(lines.text, "c")); got != (lsproto.Position{Line: 1, Character: 3}) {
		t.Errorf("position of c = %v", got)
	}
	for _, p := range []lsproto.Position{{Line: 0, Character: 2}, {Line: 1, Character: 2}, {Line: 4, Character: 0}, {Line: 1, Character: 5}} {
		if got := lines.offset(p); got != -1 {
			t.Errorf("offset(%v) = %d, want -1: past a line, inside a surrogate pair, or past the document", p, got)
		}
	}
	if got := lines.offset(lsproto.Position{Line: 3, Character: 0}); got != len(lines.text) {
		t.Errorf("the end of the document is at %d", got)
	}
	text, spans, err := toolsApply("abcdef", []*lsproto.TextEdit{
		{Range: lsproto.Range{Start: lsproto.Position{Character: 4}, End: lsproto.Position{Character: 5}}, NewText: "XY"},
		{Range: lsproto.Range{Start: lsproto.Position{Character: 1}, End: lsproto.Position{Character: 2}}},
	})
	if err != nil || text != "acdXYf" {
		t.Errorf("toolsApply = %q, %v", text, err)
	}
	// The replaced range [4, 5) maps to its replacement [3, 5).
	if got := []int{toolsMap(5, spans, true), toolsMap(4, spans, true), toolsMap(5, spans, false)}; !slices.Equal(got, []int{5, 3, 5}) {
		t.Errorf("toolsMap = %v", got)
	}
	if _, _, err := toolsApply("abcdef", []*lsproto.TextEdit{
		{Range: lsproto.Range{Start: lsproto.Position{Character: 1}, End: lsproto.Position{Character: 3}}},
		{Range: lsproto.Range{Start: lsproto.Position{Character: 2}, End: lsproto.Position{Character: 4}}},
	}); err == nil {
		t.Error("overlapping edits applied")
	}
	if got := toolsComments("a // x\nb = `${c} // no` /* y\n   z */ + /re//.source // w"); !slices.Equal(got, []string{"// x", "/* y\nz */", "// w"}) {
		t.Errorf("toolsComments = %q", got)
	}
	if lost := toolsLostComments("// a\n// b\n", "// b\n"); !slices.Equal(lost, []string{"// a"}) {
		t.Errorf("toolsLostComments = %q", lost)
	}
	bad := toolsBadRanges(lsproto.Location{Uri: "file:///x.vibe", Range: lsproto.Range{End: lsproto.Position{Line: 0, Character: 9}}}, "file:///y.vibe", func(lsproto.DocumentUri) (string, bool) { return "short\n", true })
	if len(bad) != 1 || !strings.Contains(bad[0], "file:///x.vibe") {
		t.Errorf("toolsBadRanges = %q", bad)
	}
	if got := toolsPanicFrame([]byte("goroutine 1 [running]:\npanic({0x1, 0x2})\n\t/x/panic.go:1\ngithub.com/microsoft/TypeScript/tsc/internal/debug.Fail(...)\n\t/x\ngithub.com/microsoft/TypeScript/tsc/internal/ls.(*LanguageService).Hover(0x1)\n\t/x\n")); got != "ls.LanguageService.Hover" {
		t.Errorf("toolsPanicFrame = %q", got)
	}

	// Chapter 28's codes that --fix fixes, read from the specification.
	codes := toolsFixCodes()
	for _, want := range []int32{1002, 1009, 1023, 2112, 2113, 2120, 2121, 4830, 4837, 4839, 4840} {
		if !slices.Contains(codes, want) {
			t.Errorf("toolsFixCodes() = %v lacks EK%d", codes, want)
		}
	}
	// EK4802's quick fix belongs to the editor; --fix does not apply it.
	if slices.Contains(codes, 4802) {
		t.Errorf("toolsFixCodes() = %v holds EK4802, whose quick fix Chapter 28 leaves to the editor", codes)
	}
	for _, code := range codes {
		if !SpecHasCode(code) {
			t.Errorf("EK%d is not in Chapter 28's registry", code)
		}
	}

	// An incremental edit never splits a character or a "\r\n".
	source := "a😀\r\nb catch (e) => 1\n"
	for op := range 256 {
		for position := range len(source) + 2 {
			start, end, insert := toolsIncrementalEdit(source, byte(op), position)
			edited := source[:start] + insert + source[end:]
			if start > end || !utf8.ValidString(edited) || strings.Count(edited, "\r") != strings.Count(edited, "\r\n") {
				t.Fatalf("edit %d at %d: [%d, %d) %q splits the text: %q", op, position, start, end, insert, edited)
			}
		}
	}

	// The language server's TypeScript formatter changes layout.
	formatted, err := vibelangfmt.Format("main.vibe", "function  f()   {\nreturn 1 catch (e) => 2\n}\n", toolsFormatter(t))
	if err != nil || formatted == "function  f()   {\nreturn 1 catch (e) => 2\n}\n" {
		t.Errorf("the formatter left the file as it was: %q, %v", formatted, err)
	}
}

// TestToolsIncrementalSession checks FuzzIncremental's machinery: a
// didChange edit reaches the session, which then reports the error the edit
// makes, as a fresh compilation does.
func TestToolsIncrementalSession(t *testing.T) {
	w := NewWorkspace(t)
	session, err := newToolsSession(w)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	files := map[string]string{"main.vibe": "export function f() {\n  return 1\n}\n"}
	dir, err := toolsWrite(w, Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	uri := toolsURI(dir, "main.vibe")
	session.DidOpenFile(t.Context(), uri, 1, files["main.vibe"], toolsLanguage)
	session.DidChangeFile(t.Context(), uri, 2, []lsproto.TextDocumentContentChangePartialOrWholeDocument{{
		Partial: &lsproto.TextDocumentContentChangePartial{Range: lsproto.Range{Start: lsproto.Position{Line: 1, Character: 9}, End: lsproto.Position{Line: 1, Character: 10}}, Text: "missing"},
	}})
	service, err := session.GetLanguageService(t.Context(), uri)
	if err != nil {
		t.Fatal(err)
	}
	got, err := toolsDiagnostics(t.Context(), service, uri)
	if err != nil {
		t.Fatal(err)
	}
	files["main.vibe"] = "export function f() {\n  return missing\n}\n"
	want, err := toolsFreshDiagnostics(t, w, files, "main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	if len(want) == 0 || !slices.ContainsFunc(want, func(d *lsproto.Diagnostic) bool { return strings.Contains(toolsDiagnosticKey(d), "2304 ") }) {
		t.Fatalf("a fresh compilation of `return missing` reports %v, want TS2304", toolsDiagnosticKeys(want))
	}
	if missing, extra := toolsDiagnosticDiff(want, got); len(missing)+len(extra) > 0 {
		t.Fatalf("the session reports %v more and %v fewer than a fresh compilation", extra, missing)
	}
}

func toolsDiagnosticKeys(diagnostics []*lsproto.Diagnostic) []string {
	var keys []string
	for _, d := range diagnostics {
		keys = append(keys, toolsDiagnosticKey(d))
	}
	return keys
}

// TestToolsCommentNeighbors catches relocation that a comment multiset misses
// and permits whitespace changes, as Chapter 28, Rewrites keep meaning (D372).
func TestToolsCommentNeighbors(t *testing.T) {
	before := "a /* same */ + b; c /* same */ + d"
	after := "a + b /* same */; c /* same */ + d"
	if len(toolsLostComments(before, after)) != 0 || len(toolsMovedComments(before, after)) != 1 {
		t.Fatal("relocated comment was not detected")
	}
	if moved := toolsMovedComments("x /* note */ + y; x + y", "x + y; x /* note */ + y"); len(moved) != 1 {
		t.Fatal("moving a comment between identical statements passed")
	}
	if moved := toolsMovedComments(before, "a\n/* same */\n+ b; c /* same */ + d"); len(moved) != 0 {
		t.Fatalf("layout moved comments: %v", moved)
	}
	if moved := toolsMovedComments("// first\na // last", "// first\n a\n// last"); len(moved) != 0 {
		t.Fatalf("boundary comments moved: %v", moved)
	}
}

// TestToolsFormatKey keys the emit oracle's differences by what changed, so
// that one known difference does not hide another.
func TestToolsFormatKey(t *testing.T) {
	diagnostic := func(code int32, category diagnostics.Category) *ast.Diagnostic {
		return ast.NewDiagnosticFromText(nil, core.TextRange{}, code, category, "x", nil, nil, false, false)
	}
	outputs := func() map[string]string { return map[string]string{"out/main.js": "export const x = 1;"} }
	before := &Result{Diagnostics: []*ast.Diagnostic{diagnostic(4618, diagnostics.CategoryError)}, Outputs: outputs()}
	for _, c := range []struct {
		name  string
		after []*ast.Diagnostic
		js    string
		want  string
	}{
		{"lost", nil, "", "lost:TS4618"},
		{"added", []*ast.Diagnostic{diagnostic(4618, diagnostics.CategoryError), diagnostic(2304, diagnostics.CategoryError)}, "", "added:TS2304"},
		{"both", []*ast.Diagnostic{diagnostic(2304, diagnostics.CategoryError)}, "", "lost:TS4618:added:TS2304"},
		{"category", []*ast.Diagnostic{diagnostic(4618, diagnostics.CategoryWarning)}, "", "diagnostics"},
		{"js", []*ast.Diagnostic{diagnostic(4618, diagnostics.CategoryError)}, "export const x = 2;", "js"},
	} {
		after := &Result{Diagnostics: c.after, Outputs: outputs()}
		if c.js != "" {
			after.Outputs["out/main.js"] = c.js
		}
		if got := toolsFormatKey(before, after); got != c.want {
			t.Errorf("%s: toolsFormatKey = %q, want %q", c.name, got, c.want)
		}
	}
}

// TestToolsFormatTokens makes the independent D276/D372 emit oracle reject a
// semantic mutation even though diagnostic codes and categories are unchanged.
func TestToolsFormatTokens(t *testing.T) {
	before := &Result{Outputs: map[string]string{"out/main.js": "export const x = `a${1}/*text*/`; // comment"}}
	after := &Result{Outputs: map[string]string{"out/main.js": "export const x=`a${1}/*text*/`; /* comment */"}}
	if difference := toolsFormatDifference(before, after); difference != "" {
		t.Fatal(difference)
	}
	after.Outputs["out/main.js"] = "export const x = `a${2}/*text*/`;"
	if difference := toolsFormatDifference(before, after); difference == "" {
		t.Fatal("changed JavaScript value passed independent oracle")
	}
	delete(after.Outputs, "out/main.js")
	if toolsFormatDifference(before, after) == "" {
		t.Fatal("missing JS passed independent oracle")
	}
}

// TestToolsIncrementalTokens proves every listed token is actually emitted
// by the decoder, not just selected for a delete operation (Chapter 28, D32).
func TestToolsIncrementalTokens(t *testing.T) {
	seen := map[string]bool{}
	for op := range 256 {
		_, _, insert := toolsIncrementalEdit("x", byte(op), 0)
		if op%6 == 4 {
			insert = strings.TrimPrefix(insert, "\n")
		}
		if insert != "" {
			seen[insert] = true
		}
	}
	for _, token := range toolsEditTokens {
		if !seen[token] {
			t.Errorf("incremental token %q is unreachable", token)
		}
	}
	files := map[string]string{"main.vibe": "", "dep.vibe": "", "tsconfig.json": ""}
	if got := toolsProjectFiles(files); !slices.Equal(got, []string{"dep.vibe", "main.vibe", "tsconfig.json"}) {
		t.Fatalf("edit targets = %v", got)
	}
}

// TestToolsOutcomes checks D372's comparison and rejects crashes, timeouts
// and plain returns even if two runs produced the same invalid outcome.
func TestToolsOutcomes(t *testing.T) {
	for _, kind := range []string{"crash", "timeout", "plain", ""} {
		if !toolsInvalidOutcome(Outcome{Kind: kind}) {
			t.Errorf("%q accepted as an Effect outcome", kind)
		}
	}
	a := Outcome{Kind: "success", Value: []byte(`{"a":1,"b":2}`)}
	b := Outcome{Kind: "success", Value: []byte(`{"b":2,"a":1}`)}
	if !toolsSameOutcome(a, b) {
		t.Error("JSON key order changed comparison")
	}
	b.Kind = "failure"
	if toolsSameOutcome(a, b) {
		t.Error("exit kind was ignored")
	}
	b = a
	b.Tag = "Changed"
	if toolsSameOutcome(a, b) {
		t.Error("tag was ignored")
	}
	b = a
	b.Value = []byte(`3`)
	if toolsSameOutcome(a, b) {
		t.Error("value was ignored")
	}
	entries := toolsRunnableExports(&Result{Outputs: map[string]string{
		"out/other.d.ts": "export declare function run(): Effect.Effect<number, never, never>;\nexport declare const arrow: () => Effect.Effect<string>;\nexport declare function plain(): number;\nexport declare function needs(n: number): Effect.Effect<number>;\nexport declare const maker: () => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;\nexport declare function imported(): import(\"effect/Effect\").Effect<number>;",
		"out/other.js":   "",
	}})
	if !slices.Equal(entries, []toolsRunnable{{"out/other.js", "arrow"}, {"out/other.js", "imported"}, {"out/other.js", "run"}}) {
		t.Fatalf("runnable exports = %v", entries)
	}
}

// TestToolsIncrementalDependency verifies that didChange in an imported .vibe
// file invalidates its importer's diagnostics (Chapter 28, The editor, D61).
func TestToolsIncrementalDependency(t *testing.T) {
	w := NewWorkspace(t)
	session, err := newToolsSession(w)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	files := map[string]string{
		"main.vibe": "import { value } from \"./dep.vibe\"\nexport const check: number = value\n",
		"dep.vibe":  "export const value = 1\n",
	}
	dir, err := toolsWrite(w, Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range toolsProjectFiles(files) {
		session.DidOpenFile(t.Context(), toolsURI(dir, name), 1, files[name], toolsLanguage)
	}
	main := toolsURI(dir, "main.vibe")
	if _, err := session.GetLanguageService(t.Context(), main); err != nil {
		t.Fatal(err)
	}
	files["dep.vibe"] = "export const value = \"changed\"\n"
	session.DidChangeFile(t.Context(), toolsURI(dir, "dep.vibe"), 2, []lsproto.TextDocumentContentChangePartialOrWholeDocument{{WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{Text: files["dep.vibe"]}}})
	service, err := session.GetLanguageService(t.Context(), main)
	if err != nil {
		t.Fatal(err)
	}
	got, err := toolsDiagnostics(t.Context(), service, main)
	if err != nil {
		t.Fatal(err)
	}
	want, err := toolsFreshDiagnostics(t, w, files, "main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	if len(want) == 0 {
		t.Fatal("dependency edit did not create a diagnostic")
	}
	if missing, extra := toolsDiagnosticDiff(want, got); len(missing)+len(extra) > 0 {
		t.Fatalf("dependency invalidation: missing %v; extra %v", missing, extra)
	}
}

// TestToolsEditorAnswers prevents empty LSP unions from satisfying the
// declared-identifier probes in Chapter 28, The editor (D61, D77, D78).
func TestToolsEditorAnswers(t *testing.T) {
	if toolsHasHover(lsproto.HoverResponse{}) || toolsHasHover(lsproto.HoverResponse{Hover: &lsproto.Hover{}}) {
		t.Fatal("empty hover accepted")
	}
	if toolsHasDefinition(lsproto.DefinitionResponse{}) {
		t.Fatal("empty definition accepted")
	}
	if !toolsHasDefinition(lsproto.DefinitionResponse{Location: &lsproto.Location{Uri: "file:///decl.vibe"}}) {
		t.Fatal("definition location rejected")
	}
	text := "declared value"
	if !toolsHasHover(lsproto.HoverResponse{Hover: &lsproto.Hover{Contents: lsproto.MarkupContentOrStringOrMarkedStringWithLanguageOrMarkedStrings{String: &text}}}) {
		t.Fatal("hover text rejected")
	}
}

// TestToolsFormatProjectPaths protects D1's path-based service identity while
// checking the D276/D372 emitted-token oracle at a fixed project path.
func TestToolsFormatProjectPaths(t *testing.T) {
	w := NewWorkspace(t)
	before := toolsCompile(t, w, "FuzzFormat", Single("service S { value: string }\nexport function read() { return S().value }\n").Files)
	defer before.Remove()
	after := toolsRecompile(t, w, before, Single("service S {\n value: string\n}\nexport function read() {\n return S().value\n}\n").Files)
	if difference := toolsFormatDifference(before, after); difference != "" {
		t.Fatal(difference)
	}
}

// TestToolsFreshOutcomes distinguishes module-cache state from genuine runtime
// variation before declaring a D372 comparison inconclusive.
func TestToolsFreshOutcomes(t *testing.T) {
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	r := &Result{Dir: w.Dir + "/stateful", Outputs: map[string]string{"out/main.js": `import { Effect } from "effect";
let count = 0;
export function main() { return Effect.succeed(++count); }
`}}
	entry := toolsRunnable{"out/main.js", "main"}
	first, cached := node.Run(r, entry.file, entry.name), node.Run(r, entry.file, entry.name)
	if toolsInvalidOutcome(first) || toolsInvalidOutcome(cached) || toolsSameOutcome(first, cached) {
		t.Fatalf("expected module-local state: first %+v, cached %+v", first, cached)
	}
	fresh, again := toolsFreshOutcome(t, w, r, entry), toolsFreshOutcome(t, w, r, entry)
	if !toolsSameOutcome(first, fresh) || !toolsSameOutcome(fresh, again) {
		t.Fatalf("fresh originals vary: first %+v, fresh %+v, again %+v", first, fresh, again)
	}
}

// TestToolsFreshExcludedFile checks fresh project selection after a config
// edit excludes an open document (Chapter 28, The editor, D32/D61).
func TestToolsFreshExcludedFile(t *testing.T) {
	w := NewWorkspace(t)
	files := map[string]string{
		"main.vibe":     "const value: number = \"wrong\"\n",
		"other.vibe":    "export const other = 1\n",
		"tsconfig.json": `{ "files": ["other.vibe"] }`,
	}
	diagnostics, err := toolsFreshDiagnostics(t, w, files, "main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(diagnostics, func(d *lsproto.Diagnostic) bool { return strings.Contains(toolsDiagnosticKey(d), "2322 ") }) {
		t.Fatalf("excluded document lacks its inferred-project error: %v", toolsDiagnosticKeys(diagnostics))
	}
}
