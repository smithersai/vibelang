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
	cases := []struct{ name, source, want string }{
		{"effect type", `function f(): User!NotFound!Db { return g() }`,
			`effect-type range="User!NotFound!Db"`},
		{"effect type without slots", `type T = string!!`,
			`effect-type range="string!!"`},
		{"mutable", `interface Cart { id: string; mutable items: string[]; mutable [key: string]: unknown }`,
			"mutable range=\"mutable items\" word=\"mutable\"\nmutable index range=\"mutable [key\" word=\"mutable\""},
		{"error", "/** doc */\nexport error NotFound<T> { id: T }",
			`declaration error range="export error NotFound<T> { id: T }" head="error NotFound" open="{" close="}"`},
		{"error without fields", `error Timeout`,
			`declaration error range="error Timeout" head="error Timeout"`},
		{"error class", "abstract error Http implements Coded { status: number; abstract describe(): string }",
			`declaration error class range="abstract error Http implements Coded { status: number; abstract describe(): string }" head="error Http" open="{" close="}"`},
		{"error subclass without a body", "error Timeout extends AppError\nconst x = 1",
			`declaration error class range="error Timeout extends AppError" head="error Timeout"`},
		{"error with mutable field", "error Counted extends Base { mutable count: number }",
			"declaration error class range=\"error Counted extends Base { mutable count: number }\" head=\"error Counted\" open=\"{\" close=\"}\"\nmutable range=\"mutable count\" word=\"mutable\""},
		{"schema error", "schema error FsError { method: string }",
			`declaration schema error range="schema error FsError { method: string }" head="schema error FsError" open="{" close="}"`},
		{"schema error subclass", "schema error Missing extends FsError { path: string; describe(): string { return this.path } }",
			`declaration schema error class range="schema error Missing extends FsError { path: string; describe(): string { return this.path } }" head="schema error Missing" open="{" close="}"`},
		{"service", `service Users { find(id: string): string!Gone }`,
			"declaration service range=\"service Users { find(id: string): string!Gone }\" head=\"service Users\" open=\"{\" close=\"}\"\neffect-type range=\"string!Gone\""},
		{"service of a shape", `service Prefix: string {}`,
			`declaration service range="service Prefix: string {}" head="service Prefix: string" right="string" open="{" close="}"`},
		{"service of a shape with a body", `export service Search: SearchApi { static readonly key = "app/Search" }`,
			`declaration service range="export service Search: SearchApi { static readonly key = \"app/Search\" }" head="service Search: SearchApi" right="SearchApi" open="{" close="}"`},
		{"service of a function shape", `service Format: (value: string) => string!! {}`,
			"declaration service range=\"service Format: (value: string) => string!! {}\" head=\"service Format: (value: string) => string!!\" right=\"(value: string) => string!!\" open=\"{\" close=\"}\"\neffect-type range=\"string!!\""},
		{"schema", `schema Ticket { id: string }`,
			`declaration schema range="schema Ticket { id: string }" head="schema Ticket" open="{" close="}"`},
		{"schema alias", `export schema Code = "a" | "b"`,
			`declaration schema alias range="export schema Code = \"a\" | \"b\"" head="schema Code"`},
		{"do", `const v = do { 2 }`,
			`do range="do { 2 }" word="do" open="{" close="}"`},
		{"fork", `function f() { const t = fork read(); fork { poll() } }`,
			"prefix range=\"fork read()\" word=\"fork\"\nfork-block range=\"fork { poll() }\" word=\"fork\" open=\"{\" close=\"}\""},
		{"try operations", `function f() { const a = try.all [read()]; const b = try.any xs }`,
			"prefix range=\"try.all [read()]\" word=\"try.all\"\nprefix range=\"try.any xs\" word=\"try.any\""},
		{"join and settled operations", `function f() { const a = join task; const b = try.allSettled [read()] }`,
			"prefix range=\"join task\" word=\"join\"\nprefix range=\"try.allSettled [read()]\" word=\"try.allSettled\""},
		{"throw expression", `const v = x ?? throw new Gone()`,
			`prefix range="throw new Gone()" word="throw"`},
		{"catch", `const v = read() catch (e) => 0`,
			`catch range="read() catch (e) => 0" word="catch" left="read()" right="(e) => 0"`},
		{"pipe and topic", `const v = n |> f(%, 1)`,
			"pipe range=\"n |> f(%, 1)\" word=\"|>\" left=\"n\" right=\"f(%, 1)\"\ntopic range=\"%\" word=\"%\""},
		{"is", `const v = x is Exit.Failure(let cause)`,
			`is range="is Exit.Failure(let cause)" word="is" right="Exit.Failure(let cause)"`},
		{"match", "const v = match (x) {\n  when 1: \"one\";\n  default: \"other\"\n}",
			`match range="match (x) {` + "\\n" + `  when 1: \"one\";` + "\\n" + `  default: \"other\"` + "\\n" + `}" word="match" left="x" open="{" close="}" arm("when 1" "\"one\"" ";") arm("default" "\"other\"" "")`},
		{"try", `function f() { const v = try read(); const w = try program }`,
			"prefix range=\"try read()\" word=\"try\"\nprefix range=\"try program\" word=\"try\""},
		{"provide", `function f() { provide Logger.layer([]), Random = seeded { roll() } }`,
			`block-statement range="provide Logger.layer([]), Random = seeded { roll() }" word="provide" head="provide Logger.layer([]), Random = seeded" open="{" close="}"`},
		{"mask", `function f() { uninterruptible { read() } }`,
			`block-statement range="uninterruptible { read() }" word="uninterruptible" head="uninterruptible" open="{" close="}"`},
		{"for concurrent", `function f(ids: string[]) { for concurrent(8) (const id of ids) save(id) }`,
			`for-concurrent range="for concurrent(8)" word="for" head="concurrent(8)"`},
		{"clauses", `function f() { try { a() } handle Ask.answer(q) { resume(true) } catch (e) { c() } }`,
			"clause handle range=\"handle Ask.answer(q) { resume(true) }\" head=\"handle Ask.answer(q) \" open=\"{\" close=\"}\"\nclause catch range=\"catch (e) { c() }\" head=\"catch (e) \" open=\"{\" close=\"}\""},
		// Typed and repeated catch clauses are retired (D216) but still parse.
		{"retired typed clauses", `function f() { try { a() } catch (e: Gone) { b() } catch (e) { c() } }`,
			"clause catch range=\"catch (e: Gone) { b() }\" head=\"catch (e: Gone) \" open=\"{\" close=\"}\"\nclause catch range=\"catch (e) { c() }\" head=\"catch (e) \" open=\"{\" close=\"}\""},
		{"finally binding", `function f() { try { a() } finally (exit) { log(exit) } }`,
			`clause finally range="finally (exit) { log(exit) }" word="finally" head="finally (exit)" right="(exit)" open="{" close="}"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, c.source)
			diagnostics := file.Diagnostics()
			if c.name == "clauses" {
				if len(diagnostics) != 1 || diagnostics[0].Source() != "EK" || diagnostics[0].Code() != 3501 {
					t.Fatalf("retired handle recovery diagnostics: %v", diagnostics)
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
// pipe input starts with a parenthesized expression that is not an arrow.
func TestVibeLangSyntaxDropsAbandonedLookaheads(t *testing.T) {
	t.Parallel()
	source := `const v = f((x) |> g(%), do { 1 })`
	file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("lookahead fixture rejected: %v", ds)
	}
	counts := map[parser.VibeSyntaxKind]int{}
	for _, form := range forms {
		counts[form.Kind]++
	}
	if counts[parser.VibeSyntaxPipe] != 1 || counts[parser.VibeSyntaxTopic] != 1 || counts[parser.VibeSyntaxDo] != 1 {
		t.Fatalf("forms recorded more than once:\n%s", describeVibeSyntax(source, forms))
	}
}

func TestVibeLangSyntaxOnlyForVibeFiles(t *testing.T) {
	t.Parallel()
	const source = "const v = n |> f(%)"
	vibe, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	const want = "pipe range=\"n |> f(%)\" word=\"|>\" left=\"n\" right=\"f(%)\"\ntopic range=\"%\" word=\"%\""
	if got := describeVibeSyntax(source, forms); got != want || len(vibe.Diagnostics()) != 0 {
		t.Fatalf("want a pipe and its topic in .vibe, got %s, diagnostics %v", got, vibe.Diagnostics())
	}
	_, forms = parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source)
	if len(forms) != 0 {
		t.Fatalf("a .ts file recorded %d forms", len(forms))
	}
}
