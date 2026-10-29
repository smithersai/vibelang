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
		{"service", `service class Users { find(id: string): string!Gone }`,
			"declaration service range=\"service class Users { find(id: string): string!Gone }\" head=\"service class Users\" open=\"{\" close=\"}\"\neffect-type range=\"string!Gone\""},
		{"service of a shape", `service Prefix: string`,
			`declaration service range="service Prefix: string" head="service Prefix: string" right="string"`},
		{"service of a shape with a body", `export service Search: SearchApi { static readonly layer = live }`,
			`declaration service range="export service Search: SearchApi { static readonly layer = live }" head="service Search: SearchApi" right="SearchApi" open="{" close="}"`},
		{"service of a function shape", `service Format: (value: string) => string!!`,
			"declaration service range=\"service Format: (value: string) => string!!\" head=\"service Format: (value: string) => string!!\" right=\"(value: string) => string!!\"\neffect-type range=\"string!!\""},
		{"schema", `schema Ticket { id: string }`,
			`declaration schema range="schema Ticket { id: string }" head="schema Ticket" open="{" close="}"`},
		{"schema alias", `export schema Code = "a" | "b"`,
			`declaration schema alias range="export schema Code = \"a\" | \"b\"" head="schema Code"`},
		{"block param", `const v = withSpan("load") { return 1 }`,
			`block-param range="withSpan(\"load\") { return 1 }" head="withSpan(\"load\")" open="{" close="}"`},
		{"do", `const v = do { 2 }`,
			`do range="do { 2 }" word="do" open="{" close="}"`},
		{"fork", `function f() { const t = fork read(); fork { poll() } }`,
			"prefix range=\"fork read()\" word=\"fork\"\nfork-block range=\"fork { poll() }\" word=\"fork\" open=\"{\" close=\"}\""},
		{"try operations", `function f() { const a = try.all [read()]; const b = try.any xs }`,
			"prefix range=\"try.all [read()]\" word=\"try.all\"\nprefix range=\"try.any xs\" word=\"try.any\""},
		{"join and await operations", `function f() { const a = join task; const b = await.allSettled [read()] }`,
			"prefix range=\"join task\" word=\"join\"\nprefix range=\"await.allSettled [read()]\" word=\"await.allSettled\""},
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
			if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
				t.Fatalf("syntax rejected: %v", diagnostics[0].String())
			}
			if got := describeVibeSyntax(c.source, forms); got != c.want {
				t.Fatalf("recorded\n%s\nwant\n%s", got, c.want)
			}
		})
	}
}

// A form inside a lookahead the parser abandons must not be recorded: the
// arrow function parser tries (e) => match ... as a parenthesized arrow first.
func TestVibeLangSyntaxDropsAbandonedLookaheads(t *testing.T) {
	t.Parallel()
	source := `const v = f((x) |> g(%), do { 1 })`
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	counts := map[parser.VibeSyntaxKind]int{}
	for _, form := range forms {
		counts[form.Kind]++
	}
	if counts[parser.VibeSyntaxPipe] != 1 || counts[parser.VibeSyntaxTopic] != 1 || counts[parser.VibeSyntaxDo] != 1 {
		t.Fatalf("forms recorded more than once:\n%s", describeVibeSyntax(source, forms))
	}
}

// A .ts file records nothing, and ParseSourceFile records nothing anywhere.
func TestVibeLangSyntaxOnlyForVibeFiles(t *testing.T) {
	t.Parallel()
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, `const v = a ?? b`)
	if len(forms) != 0 {
		t.Fatalf("a .ts file recorded %d forms", len(forms))
	}
}
