package parser_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// describeVibeSyntax writes each recorded form as one line naming its kind and
// the source text of its ranges, so a test reads as the syntax it pins.
func describeVibeSyntax(source string, forms []parser.VibeSyntax) string {
	text := func(r core.TextRange) string {
		if r.Pos() == r.End() {
			return ""
		}
		return source[r.Pos():r.End()]
	}
	names := map[parser.VibeSyntaxKind]string{
		parser.VibeSyntaxEffect:         "effect",
		parser.VibeSyntaxEffectType:     "effect-type",
		parser.VibeSyntaxMutable:        "mutable",
		parser.VibeSyntaxDeclaration:    "declaration",
		parser.VibeSyntaxBlockParam:     "block-param",
		parser.VibeSyntaxDo:             "do",
		parser.VibeSyntaxForkBlock:      "fork-block",
		parser.VibeSyntaxPrefix:         "prefix",
		parser.VibeSyntaxCatch:          "catch",
		parser.VibeSyntaxPipe:           "pipe",
		parser.VibeSyntaxTopic:          "topic",
		parser.VibeSyntaxIs:             "is",
		parser.VibeSyntaxMatch:          "match",
		parser.VibeSyntaxBlockStatement: "block-statement",
		parser.VibeSyntaxForConcurrent:  "for-concurrent",
		parser.VibeSyntaxClause:         "clause",
		parser.VibeSyntaxStatement:      "statement",
		parser.VibeSyntaxForTry:         "for-try",
		parser.VibeSyntaxShorthand:      "shorthand",
		parser.VibeSyntaxSpec:           "spec",
	}
	sorted := slices.Clone(forms)
	slices.SortStableFunc(sorted, func(a, b parser.VibeSyntax) int { return a.Range.Pos() - b.Range.Pos() })
	var lines []string
	for _, form := range sorted {
		parts := []string{names[form.Kind]}
		add := func(label string, r core.TextRange) {
			if r.Pos() != r.End() {
				parts = append(parts, fmt.Sprintf("%s=%q", label, text(r)))
			}
		}
		if form.Name != "" {
			parts = append(parts, form.Name)
		}
		if form.Index {
			parts = append(parts, "index")
		}
		if form.Class {
			parts = append(parts, "class")
		}
		add("range", form.Range)
		add("word", form.Word)
		add("head", form.Head)
		add("left", form.Left)
		add("right", form.Right)
		add("open", form.Open)
		add("close", form.Close)
		for _, arm := range form.Arms {
			parts = append(parts, fmt.Sprintf("arm(%q %q %q)", text(arm.Head), text(arm.Value), text(arm.Semicolon)))
		}
		lines = append(lines, strings.Join(parts, " "))
	}
	return strings.Join(lines, "\n")
}

func TestVibeLangSyntaxRecordsEachForm(t *testing.T) {
	t.Parallel()
	// retired names why a row's form is no longer the language; the parser
	// still records it for recovery. diagnostic is the one parser diagnostic
	// the row must report, as "EK3501"; a row without one parses cleanly.
	cases := []struct{ name, source, want, retired, diagnostic string }{
		{"effect type", `function f(): User!NotFound!Db { return g() }`,
			`effect-type range="User!NotFound!Db"`, "", ""},
		{"effect type without slots", `type T = string!!`,
			`effect-type range="string!!"`, "", ""},
		{"mutable", `interface Cart { id: string; mutable items: string[]; mutable [key: string]: unknown }`,
			"mutable range=\"mutable items\" word=\"mutable\"\nmutable index range=\"mutable [key\" word=\"mutable\"", "", ""},
		{"error", "/** doc */\nexport error NotFound<T> { id: T }",
			`declaration error range="export error NotFound<T> { id: T }" head="error NotFound" open="{" close="}"`, "", ""},
		{"error without fields", `error Timeout`,
			`declaration error range="error Timeout" head="error Timeout"`, "", ""},
		{"error class", "abstract error Http implements Coded { status: number; abstract describe(): string }",
			`declaration error class range="abstract error Http implements Coded { status: number; abstract describe(): string }" head="error Http" open="{" close="}"`, "", ""},
		{"error subclass without a body", "error Timeout extends AppError\nconst x = 1",
			`declaration error class range="error Timeout extends AppError" head="error Timeout"`, "", ""},
		{"error with mutable field", "error Counted extends Base { mutable count: number }",
			"declaration error class range=\"error Counted extends Base { mutable count: number }\" head=\"error Counted\" open=\"{\" close=\"}\"\nmutable range=\"mutable count\" word=\"mutable\"", "", ""},
		{"schema error", "schema error FsError { method: string }",
			`declaration schema error range="schema error FsError { method: string }" head="schema error FsError" open="{" close="}"`, "", ""},
		{"schema error subclass", "schema error Missing extends FsError { path: string; describe(): string { return this.path } }",
			`declaration schema error class range="schema error Missing extends FsError { path: string; describe(): string { return this.path } }" head="schema error Missing" open="{" close="}"`, "", ""},
		{"service", `service Users { find(id: string): string!Gone }`,
			"declaration service range=\"service Users { find(id: string): string!Gone }\" head=\"service Users\" open=\"{\" close=\"}\"\neffect-type range=\"string!Gone\"", "", ""},
		{"retired service class", `service class Users { find(id: string): string!Gone }`,
			"declaration service range=\"service class Users { find(id: string): string!Gone }\" head=\"service class Users\" open=\"{\" close=\"}\"\neffect-type range=\"string!Gone\"",
			"service class is EK0909, which the checker reports (vibelang/declaration_forms.go)", ""},
		{"service of a shape", `service Prefix: string {}`,
			`declaration service range="service Prefix: string {}" head="service Prefix: string" right="string" open="{" close="}"`, "", ""},
		{"service of a shape with a body", `export service Search: SearchApi { static readonly key = "app/Search" }`,
			`declaration service range="export service Search: SearchApi { static readonly key = \"app/Search\" }" head="service Search: SearchApi" right="SearchApi" open="{" close="}"`, "", ""},
		{"service of a function shape", `service Format: (value: string) => string!! {}`,
			"declaration service range=\"service Format: (value: string) => string!! {}\" head=\"service Format: (value: string) => string!!\" right=\"(value: string) => string!!\" open=\"{\" close=\"}\"\neffect-type range=\"string!!\"", "", ""},
		{"schema", `schema Ticket { id: string }`,
			`declaration schema range="schema Ticket { id: string }" head="schema Ticket" open="{" close="}"`, "", ""},
		{"schema alias", `export schema Code = "a" | "b"`,
			`declaration schema alias range="export schema Code = \"a\" | \"b\"" head="schema Code"`, "", ""},
		{"do", `const v = do { 2 }`,
			`do range="do { 2 }" word="do" open="{" close="}"`, "", ""},
		{"effect function", `export effect function load(id: string) { const user = try find(id); return user }`,
			"effect range=\"effect function load(id: string) { const user = try find(id); return user }\" word=\"effect\"\nprefix range=\"try find(id)\" word=\"try\"", "", ""},
		{"effect block", `const program = effect { const n = try read(); return n }`,
			"effect range=\"effect { const n = try read(); return n }\" word=\"effect\" open=\"{\" close=\"}\"\nprefix range=\"try read()\" word=\"try\"", "", ""},
		{"catch effect", `const v = read() catch effect (e) => match (e) { when Gone: 0; default: throw e; }`,
			"catch range=\"read() catch effect (e) => match (e) { when Gone: 0; default: throw e; }\" word=\"catch\" left=\"read()\" right=\"effect (e) => match (e) { when Gone: 0; default: throw e; }\"\neffect range=\"effect (e) => match (e) { when Gone: 0; default: throw e; }\" word=\"effect\"\nmatch range=\"match (e) { when Gone: 0; default: throw e; }\" word=\"match\" left=\"e\" open=\"{\" close=\"}\" arm(\"when Gone\" \"0\" \";\") arm(\"default\" \"throw e\" \";\")\nprefix range=\"throw e\" word=\"throw\"", "", ""},
		{"fork", `effect function f() { const t = fork read(); fork { try poll() } }`,
			"effect range=\"effect function f() { const t = fork read(); fork { try poll() } }\" word=\"effect\"\nprefix range=\"fork read()\" word=\"fork\"\nfork-block range=\"fork { try poll() }\" word=\"fork\" open=\"{\" close=\"}\"\nprefix range=\"try poll()\" word=\"try\"", "", ""},
		{"try operations", `effect function f() { const a = try.all [read()]; const b = try.any xs }`,
			"effect range=\"effect function f() { const a = try.all [read()]; const b = try.any xs }\" word=\"effect\"\nprefix range=\"try.all [read()]\" word=\"try.all\"\nprefix range=\"try.any xs\" word=\"try.any\"", "", ""},
		{"join and try.allSettled", `effect function f() { const a = join task; const b = try.allSettled [read()] }`,
			"effect range=\"effect function f() { const a = join task; const b = try.allSettled [read()] }\" word=\"effect\"\nprefix range=\"join task\" word=\"join\"\nprefix range=\"try.allSettled [read()]\" word=\"try.allSettled\"", "", ""},
		{"retired await operation", `function f() { const b = await.allSettled [read()] }`,
			`prefix range="await.allSettled [read()]" word="await.allSettled"`,
			"await.allSettled is EK1802 (VIP-18), which the checker reports (vibelang/retired_await_operations.go)", ""},
		{"throw expression", `const v = x ?? throw new Gone()`,
			`prefix range="throw new Gone()" word="throw"`, "", ""},
		{"catch", `const v = read() catch (e) => 0`,
			`catch range="read() catch (e) => 0" word="catch" left="read()" right="(e) => 0"`, "", ""},
		{"pipe and topic", `const v = n |> f(%, 1)`,
			"pipe range=\"n |> f(%, 1)\" word=\"|>\" left=\"n\" right=\"f(%, 1)\"\ntopic range=\"%\" word=\"%\"", "", ""},
		{"is", `const v = x is Exit.Failure(let cause)`,
			`is range="is Exit.Failure(let cause)" word="is" right="Exit.Failure(let cause)"`, "", ""},
		{"match", "const v = match (x) {\n  when 1: \"one\";\n  default: \"other\"\n}",
			`match range="match (x) {` + "\\n" + `  when 1: \"one\";` + "\\n" + `  default: \"other\"` + "\\n" + `}" word="match" left="x" open="{" close="}" arm("when 1" "\"one\"" ";") arm("default" "\"other\"" "")`, "", ""},
		{"try", `effect function f() { const v = try read(); const w = try program }`,
			"effect range=\"effect function f() { const v = try read(); const w = try program }\" word=\"effect\"\nprefix range=\"try read()\" word=\"try\"\nprefix range=\"try program\" word=\"try\"", "", ""},
		{"provide", `effect function f() { provide Logger.layer([]), Random = seeded { try roll() } }`,
			"effect range=\"effect function f() { provide Logger.layer([]), Random = seeded { try roll() } }\" word=\"effect\"\nblock-statement range=\"provide Logger.layer([]), Random = seeded { try roll() }\" word=\"provide\" head=\"provide Logger.layer([]), Random = seeded\" open=\"{\" close=\"}\"\nprefix range=\"try roll()\" word=\"try\"", "", ""},
		{"mask", `effect function f() { uninterruptible { try read() } }`,
			"effect range=\"effect function f() { uninterruptible { try read() } }\" word=\"effect\"\nblock-statement range=\"uninterruptible { try read() }\" word=\"uninterruptible\" head=\"uninterruptible\" open=\"{\" close=\"}\"\nprefix range=\"try read()\" word=\"try\"", "", ""},
		{"for concurrent", `effect function f(ids: string[]) { for concurrent(8) (const id of ids) { try save(id) } }`,
			"effect range=\"effect function f(ids: string[]) { for concurrent(8) (const id of ids) { try save(id) } }\" word=\"effect\"\nfor-concurrent range=\"for concurrent(8)\" word=\"for\" head=\"concurrent(8)\"\nprefix range=\"try save(id)\" word=\"try\"", "", ""},
		{"retired handle clause", `function f() { try { a() } handle Ask.answer(q) { resume(true) } catch (e) { c() } }`,
			"clause handle range=\"handle Ask.answer(q) { resume(true) }\" head=\"handle Ask.answer(q) \" open=\"{\" close=\"}\"\nclause catch range=\"catch (e) { c() }\" head=\"catch (e) \" open=\"{\" close=\"}\"",
			"handlers are an open proposal, outside the first release", "EK3501"},
		{"retired typed clauses", `function f() { try { a() } catch (e: Gone) { b() } catch (e) { c() } }`,
			"clause catch range=\"catch (e: Gone) { b() }\" head=\"catch (e: Gone) \" open=\"{\" close=\"}\"\nclause catch range=\"catch (e) { c() }\" head=\"catch (e) \" open=\"{\" close=\"}\"",
			"a typed catch clause is EK2112 (D216), which the checker reports (vibelang/diagnostics.go)", ""},
		{"retired finally binding", `function f() { try { a() } finally (exit) { log(exit) } }`,
			`clause finally range="finally (exit) { log(exit) }" word="finally" head="finally (exit)" right="(exit)" open="{" close="}"`,
			"effect code has no try statements; cleanup uses ensuring or onExit", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, c.source)
			diagnostics := file.Diagnostics()
			if c.diagnostic != "" {
				if len(diagnostics) != 1 || fmt.Sprintf("%s%04d", diagnostics[0].Source(), diagnostics[0].Code()) != c.diagnostic {
					t.Fatalf("retired form (%s): want only %s, got %v", c.retired, c.diagnostic, diagnostics)
				}
			} else if len(diagnostics) != 0 {
				t.Fatalf("syntax rejected: %v", diagnostics[0].String())
			}
			if got := describeVibeSyntax(c.source, forms); got != c.want {
				t.Fatalf("recorded\n%s\nwant\n%s", got, c.want)
			}
		})
	}
}

func TestVibeLangSyntaxRecordsExplicitEffects(t *testing.T) {
	t.Parallel()
	const source = `effect function run() { return try work() }
const program = effect { return try work() }
const recover = work() catch effect (e) => { return try fallback(e) }`
	file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("explicit effects rejected: %v", ds)
	}

	counts := map[string]int{}
	for _, form := range forms {
		word := source[form.Word.Pos():form.Word.End()]
		switch form.Kind {
		case parser.VibeSyntaxEffect, parser.VibeSyntaxPrefix, parser.VibeSyntaxCatch:
			counts[word]++
		}
	}
	for word, want := range map[string]int{"effect": 3, "try": 3, "catch": 1} {
		if got := counts[word]; got != want {
			t.Errorf("recorded %d %q forms, want %d:\n%s", got, word, want, describeVibeSyntax(source, forms))
		}
	}
}

// A form inside a lookahead the parser abandons must not be recorded: the
// arrow function parser first tries (x) as an arrow's parameter list, and the
// call's arguments, which hold do { 1 }, as a parenthesized arrow, before it
// parses (x) |> g(%) as a pipe.
func TestVibeLangSyntaxDropsAbandonedLookaheads(t *testing.T) {
	t.Parallel()
	source := `const v = f((x) |> g(%), do { 1 })`
	file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("syntax rejected: %v", diagnostics[0].String())
	}
	want := "pipe range=\"(x) |> g(%)\" word=\"|>\" left=\"(x)\" right=\"g(%)\"\ntopic range=\"%\" word=\"%\"\ndo range=\"do { 1 }\" word=\"do\" open=\"{\" close=\"}\""
	if got := describeVibeSyntax(source, forms); got != want {
		t.Fatalf("recorded\n%s\nwant\n%s", got, want)
	}
}

// A .ts file records nothing, though each source holds a form a .vibe file
// records: the VibeLang syntax is gated on the file kind, not on the recorder.
func TestVibeLangSyntaxOnlyForVibeFiles(t *testing.T) {
	t.Parallel()
	for _, source := range []string{`type T = string!!`, `const v = n |> f(%)`} {
		_, vibe := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(vibe) == 0 {
			t.Fatalf("%q: a .vibe file recorded no form, so the .ts row proves nothing", source)
		}
		_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source)
		if len(forms) != 0 {
			t.Fatalf("%q: a .ts file recorded\n%s", source, describeVibeSyntax(source, forms))
		}
	}
}
