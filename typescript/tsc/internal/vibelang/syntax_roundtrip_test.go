package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// The upstream parser test package requires Microsoft's omitted test corpus.
// Keep the VibeLang-specific corpus here so it also runs in released checkouts.
// The inputs are also the seeds for FuzzVibeLangParsePrint.
var syntaxRoundTripCases = []struct{ name, source string }{
	{"declarations", `error Gone { id: string }
schema error Invalid { reason: string }
schema Role = "admin" | "member"
schema Ticket { id: string; label?: string; role: Role }
data Delivery { Waiting; Sent { tracking: string } }`},
	{"contracts", `error Gone
service Users { find(id: string): string!Gone }
effect function read(id: string): string!Gone!Users { return try (try Users).find(id) }
type Program = number!!
type Errors = string!Gone
type Requirements = boolean!!Users`},
	{"pipe", `function f(n: number) { return n |> % % 2 |> (% ? 1 : 0) }
function g(n: number) { return n |> (% + (2 |> % * 3)) }`},
	{"fibers", `effect function run(job: number!!, scope: Scope.Scope) {
  const child = fork job
  const owned = fork.in(scope) job
  const scopedChild = fork.scoped job
  const detached = fork.detached job
  return join child
}`},
	{"try-operations", `effect function run(left: number!!, right: number!string) {
  const both = try.all [left, right]
  const settled = try.allSettled [left, right]
  const first = try.race [left, right]
  const success = try.any [left, right]
  return { both, settled, first, success }
}`},
	{"hatches", `effect function parse(raw: string) {
  const n = try Effect.try({ try: () => JSON.parse(raw), catch: (e) => String(e) })
  const doubled = try sync(() => n * 2)
  const value = try promise(() => Promise.resolve(doubled))
  return try tryPromise({ try: () => Promise.resolve(value), catch: (e) => String(e) })
}`},
	{"blocks", `const increment = effect (x: number) => x + 1
export effect function main() {
  const value = do { const x = 2; x + 1 }
  return try withSpan(effect { return try increment(value) }, "increment")
}
await runPromise(main())`},
	{"catches", `error Gone { id: string }
error Busy
effect function recover(job: string!(Gone | Busy)) {
  const fallback = job catch () => "guest"
  const tag = job catch (e) => e._tag
  return job catch effect (e) => match (e) { when Gone: e.id; default: throw e; }
}`},
	{"primitives", `effect function poll(work: number!!) {
  uninterruptible { try work; restore { try work } }
  interruptible { try work }
}`},
	{"match", `function f(value: unknown) { return match (value) { when 1: "one"; when String and let text: text; default: "other"; } }
effect function result(job: number!string) {
  return match (try exit(job)) { when Exit.Success(let n): n; when Exit.Failure(let cause): 0; }
}`},
	{"providers", `service Users { find(id: string): string!! }
const users = { effect find(id: string) { return id } }
const live = Layer.effect(Users, effect { return users })
const fallback = Layer.succeed(Users, users)
effect function read() {
  provide live, Users = users { return try (try Users).find("1") }
}`},
	{"streams", `effect function* ticks() { yield 1; try sleep("1 second"); yield 2 }
effect function consume() {
  for try (const x of ticks()) { if (x === 2) break }
  for concurrent(2) (const x of [1, 2]) { try log(x) }
}`},
	{"resources", `effect function use() {
  return try scoped(effect {
    const resource = try acquireRelease(succeed(1), () => log("closed"))
    return try ensuring(onExit(succeed(resource), (exit) => log(exit._tag)), log("done"))
  })
}`},
}

func printSyntax(file *ast.SourceFile) string {
	return printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, nil).EmitSourceFile(file)
}

func checkSyntaxRoundTrip(t *testing.T, source string) string {
	t.Helper()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
	if len(file.Diagnostics()) != 0 {
		t.Fatalf("VibeLang syntax rejected: %v\n%s", file.Diagnostics(), source)
	}
	printed := printSyntax(file)
	// Some forms (such as pipes) remain language syntax until the
	// compiler transform. Reparse as VibeLang, as editor changes would be.
	reparsed := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, printed, core.ScriptKindTS)
	if len(reparsed.Diagnostics()) != 0 {
		t.Fatalf("printed VibeLang rejected: %v\n%s", reparsed.Diagnostics(), printed)
	}
	if got, want := syntaxPipeCount(reparsed), syntaxPipeCount(file); got != want {
		t.Fatalf("printing changed %d pipes into %d pipes:\n%s", want, got, printed)
	}
	// Synthesized blocks initially keep their source parent's single-line
	// layout. Once reparsed, their own multiline layout becomes canonical.
	canonical := printSyntax(reparsed)
	third := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, canonical, core.ScriptKindTS)
	if len(third.Diagnostics()) != 0 || printSyntax(third) != canonical {
		t.Fatalf("canonical printing is not stable:\n%s\n%s", canonical, printSyntax(third))
	}
	return printed
}

func syntaxPipeCount(file *ast.SourceFile) int {
	count := 0
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isPipe(node) {
			count++
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return count
}

func TestInvalidContractPreservesDiagnostic(t *testing.T) {
	for _, source := range []string{
		`type A = #Bad!0`,
		`service A { read(): #Bad!0 }`,
		`error A { readonly A: string } service A0000 { A(A: string): #A0000!0 } schema0000 { A0 % A000000; A0 % A0000000 }`,
	} {
		file := parseVibeLang(t, source)
		if len(file.Diagnostics()) == 0 {
			t.Errorf("invalid private type has no diagnostic: %s", source)
			continue
		}
		diagnostic := file.Diagnostics()[0]
		if diagnostic.Code() != 1110 || diagnostic.Pos() != strings.Index(source, "#") {
			t.Errorf("want TS1110 at private type, got %v", diagnostic)
		}
	}
}

func TestSyntaxRoundTripGoldens(t *testing.T) {
	for _, tc := range syntaxRoundTripCases {
		t.Run(tc.name, func(t *testing.T) {
			got := checkSyntaxRoundTrip(t, tc.source)
			extension := ".ts"
			if tc.name == "pipe" {
				extension = ".vibe"
			}
			golden := filepath.Join("testdata", "syntax", tc.name+extension)
			if os.Getenv("UPDATE_VIBE_SYNTAX_GOLDENS") == "1" {
				if err := os.MkdirAll(filepath.Dir(golden), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(golden, []byte(got), 0644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatal(err)
			}
			if got != string(want) {
				t.Fatalf("syntax golden differs:\ngot:\n%s\nwant:\n%s", got, want)
			}
		})
	}
}

// The parser also accepts retired forms for diagnostic recovery. Only seed
// the golden corpus with examples that compile as user-written VibeLang.
func TestSyntaxRoundTripSources(t *testing.T) {
	for _, tc := range syntaxRoundTripCases {
		t.Run(tc.name, func(t *testing.T) {
			for _, d := range errorsOf(t, tc.source) {
				t.Errorf("%s%d: %s", d.Source(), d.Code(), d.String())
			}
		})
	}
}

// FuzzVibeLangParsePrint checks the parser/printer boundary for wide inputs.
// Broken edits still parse for recovery; diagnostic-free inputs must survive
// printing and parsing. Seed all language forms, not just JS expressions.
func FuzzVibeLangParsePrint(f *testing.F) {
	for _, tc := range syntaxRoundTripCases {
		f.Add(tc.source)
	}
	f.Add(`function f( {`)
	f.Add("// 😀\u2028export const café = 1")
	f.Fuzz(func(t *testing.T, source string) {
		if len(source) > 16*1024 || strings.ContainsRune(source, '\x00') {
			t.Skip()
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if len(file.Diagnostics()) != 0 {
			return
		}
		checkSyntaxRoundTrip(t, source)
	})
}

// D272 normalizes only the topic-only application of a curried stage.
func TestCurriedPipeSyntax(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{`const x = schema |> combinator(1)(%)`, `.pipe(combinator(1))`},
		{`const x = schema |> combinator(1)(%, 2)`, `|>`},
		{`const x = schema |> combinator(%)(%)`, `|>`},
		{`const x = schema |> combinator(1)(%.value)`, `|>`},
		{`const x = schema |> combinator(%)`, `|>`},
		// A left side that calls something may run a program, which .pipe
		// would reach only after it ran; the pipe keeps D154 (twin agent/model).
		{`const x = load() |> combinator(1)(%)`, `|>`},
		{`const x = schema |> other(%) |> combinator(1)(%)`, `|>`},
		{`const x = Schema.NullOr(Schema.String) |> combinator(1)(%)`, `|>`},
		{`const x = schema.field |> combinator(1)(%) |> next(2)(%)`, `.pipe(combinator(1)).pipe(next(2))`},
	} {
		printed := checkSyntaxRoundTrip(t, tc.source)
		if !strings.Contains(printed, tc.want) {
			t.Errorf("want %q in %s", tc.want, printed)
		}
	}
}

func TestExplicitBlockArgumentPostfixSyntax(t *testing.T) {
	for _, source := range []string{
		`const x = f(() => { return 1 }).value`,
		`const x = f(() => { return 1 })[0]`,
		`const x = f(() => { return 1 })(2)`,
		`const x = f(() => { return 1 })?.value`,
		`const x = f(() => { return 1 }).g(() => { return 2 }).value`,
	} {
		checkSyntaxRoundTrip(t, source)
	}
}
