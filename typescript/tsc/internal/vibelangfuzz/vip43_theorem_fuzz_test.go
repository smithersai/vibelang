package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-43 (Appendix F): theorem declarations. FuzzTheoremSyntax feeds the
// parser arbitrary text and checks what the grammar says of every theorem it
// reads. FuzzTheoremRules builds a theorem from a header and a list of body
// statements, predicts its rules with a model written from the
// specification's sentences, and compares the compiler with the model; a
// theorem the model accepts must also erase.
const (
	theoremKeywordQuote   = "| `theorem` | a `BindingIdentifier` other than `as`, `satisfies` or `is`, then `(` or `<` | where a TypeScript declaration can start: a `StatementListItem`, or after `export`, `export default`, `declare` or `effect` |"
	theoremLineBreakQuote = "A line break after the word keeps the TypeScript reading:"
	theoremSyntaxQuote    = "In a proof context, an expression statement whose expression is a call with an unparenthesized identifier callee spelled `assume`, `assert`, `ensures`, `invariant` or `decreases`, with no type arguments and no optional chaining, is a proof statement."
	theoremHeaderQuote    = "A missing annotation, an optional (`x?`), rest, defaulted or destructured parameter, a `this` parameter, and a return type annotation are rule 4303."
	theoremBodyQuote      = "Any other statement is rule 4305: `let`, a loop, `return`, `throw`, a nested function, an `assume` after the first other statement, or an expression statement other than a proof statement."
	theoremAssertQuote    = "A theorem with no `assert`, and a `const` that no later statement uses, are rule 4305 too: the lemma form drops an unused constant, and with it the preconditions of the calls in its initializer."
	theoremContractQuote  = "`ensures`, `invariant` and `decreases` in a theorem are rule 4306."
	theoremBlockQuote     = "A proof block there is rule 4304."
)

var theoremQuotes = []string{theoremKeywordQuote, theoremLineBreakQuote, theoremSyntaxQuote, theoremHeaderQuote, theoremBodyQuote, theoremAssertQuote, theoremContractQuote, theoremBlockQuote, procedureCallQuote, proofErasureJSQuote}

func TestTheoremQuoted(t *testing.T) {
	for _, quote := range theoremQuotes {
		chapterSays(t, "900-appendices.md", quote)
	}
}

// theoremSyntaxSeeds are sources around the edges of the theorem grammar.
var theoremSyntaxSeeds = []string{
	"theorem t(x: number) { assume(x > 0); assert(x > 0) }",
	"theorem t<T>(xs: readonly T[]) { if (xs.length > 0) { assert(true) } else assert(false) }",
	"export theorem t() { }",
	"export default theorem t() { }",
	"declare theorem t(): void",
	"theorem\nt(x)",
	"theorem as T",
	"theorem satisfies T",
	"theorem is P",
	"theorem(1)",
	"const theorem = 1; theorem",
	"theorem t",
	"theorem t(x: number): void { assert(true) }",
	"theorem t(x: number)\ntheorem t(x: number) { assert(true) }",
	"theorem t() { proof { assert(true) } }",
	"theorem t() { (assert)(true); x.assert(true); assert<boolean>(true); assert?.(true); f(assert(true)) }",
	"theorem t() { const g = () => { assert(true) }; function h() { assume(true) } }",
	"function f() { theorem t() { assert(true) } }",
	"theorem t() { assert(true) }\nassert(false)",
	"the\\u006frem t() { assert(true) }",
	"theorem t() { ass\\u0065rt(true) }",
	"theorem /* note */ t /* note */ () { assert(true, by.induction(xs)) }",
	"theorem theorem(theorem: number) { assert(theorem === theorem) }",
	"spec function f() { }\ntheorem t() { assert(f()) }",
	"effect theorem t() { }",
	"async theorem t() { }",
	"theorem t(x: number) { assert(x",
	"theorem t<",
	"theorem t(",
	"class C { theorem t() { assert(true) } }",
	"const o = { theorem t() { } }",
	"label: theorem t() { assert(true) }",
	"if (c) theorem t() { assert(true) }",
}

// theoremSyntaxFacts are the facts FuzzTheoremSyntax collects of one parse.
type theoremSyntaxFacts struct {
	theorems   []string // each theorem's name
	statements []string // each proof statement's callee
	problems   []string // what breaks the grammar's sentences
}

// collectTheoremSyntax walks file and checks each theorem and each proof
// statement against the grammar.
func collectTheoremSyntax(file *ast.SourceFile, text string) theoremSyntaxFacts {
	var facts theoremSyntaxFacts
	const theoremFlags = ast.NodeFlagsVibeLangSpec | ast.NodeFlagsVibeLangProof
	// context is the nearest enclosing function-like node or proof block.
	var visit func(n *ast.Node, context *ast.Node)
	visit = func(n *ast.Node, context *ast.Node) {
		switch {
		case n.Kind == ast.KindFunctionDeclaration && n.Flags&theoremFlags == theoremFlags:
			name := n.Name()
			if name == nil || !ast.IsIdentifier(name) {
				facts.problems = append(facts.problems, "a theorem has no name")
				break
			}
			facts.theorems = append(facts.theorems, name.Text())
			start := scanner.SkipTrivia(text, name.Pos())
			if strings.ContainsAny(text[name.Pos():start], "\n\r\u2028\u2029") {
				facts.problems = append(facts.problems, "a line break stands between theorem and "+name.Text())
			}
			switch text[start:name.End()] {
			case "as", "satisfies", "is":
				facts.problems = append(facts.problems, "a theorem is named "+text[start:name.End()])
			}
			if next := scanner.SkipTrivia(text, name.End()); next >= len(text) || text[next] != '(' && text[next] != '<' {
				facts.problems = append(facts.problems, "neither ( nor < follows the name of theorem "+name.Text())
			}
		case n.Kind == ast.KindCallExpression && n.Flags&ast.NodeFlagsVibeLangProof != 0:
			callee := n.Expression()
			if !ast.IsIdentifier(callee) || !slices.Contains([]string{"assume", "assert", "ensures", "invariant", "decreases"}, callee.Text()) {
				facts.problems = append(facts.problems, "a proof statement's callee is not one of the five names")
				break
			}
			facts.statements = append(facts.statements, callee.Text())
			if text[scanner.SkipTrivia(text, callee.Pos()):callee.End()] != callee.Text() {
				facts.problems = append(facts.problems, "the proof statement "+callee.Text()+" is spelled with an escape")
			}
			inProofContext := context != nil && (context.Kind == ast.KindBlock && context.Flags&ast.NodeFlagsVibeLangProof != 0 ||
				context.Kind == ast.KindFunctionDeclaration && context.Flags&theoremFlags == theoremFlags)
			if !inProofContext {
				facts.problems = append(facts.problems, "the proof statement "+callee.Text()+" is outside a proof context")
			}
		}
		next := context
		if ast.IsFunctionLike(n) || ast.IsClassLike(n) || n.Kind == ast.KindBlock && n.Flags&ast.NodeFlagsVibeLangProof != 0 {
			next = n
		}
		n.ForEachChild(func(child *ast.Node) bool {
			visit(child, next)
			return false
		})
	}
	visit(file.AsNode(), nil)
	return facts
}

func parseTheoremSource(fileName string, source string) *ast.SourceFile {
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName)}, source, core.ScriptKindTS)
}

func FuzzTheoremSyntax(f *testing.F) {
	startShortBudget(f)
	for _, quote := range theoremQuotes {
		chapterSays(f, "900-appendices.md", quote)
	}
	for _, seed := range theoremSyntaxSeeds {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, source string) {
		if len(source) > 4096 || !strings.Contains(source, "theorem") && !strings.Contains(source, "\\u") {
			return
		}
		facts := collectTheoremSyntax(parseTheoremSource("/app/src/main.vibe", source), source)
		for _, problem := range facts.problems {
			t.Errorf("%s / %s\n%s:\n%s", theoremKeywordQuote, theoremSyntaxQuote, problem, source)
		}
		// The parse is a function of the text.
		again := collectTheoremSyntax(parseTheoremSource("/app/src/main.vibe", source), source)
		if !slices.Equal(facts.theorems, again.theorems) || !slices.Equal(facts.statements, again.statements) {
			t.Errorf("two parses of one text differ: %v %v, then %v %v\n%s", facts.theorems, facts.statements, again.theorems, again.statements, source)
		}
		// theorem is a word of VibeLang files only.
		if ts := collectTheoremSyntax(parseTheoremSource("/app/src/main.ts", source), source); len(ts.theorems) != 0 || len(ts.statements) != 0 {
			t.Errorf("a .ts file reads theorems %v and proof statements %v:\n%s", ts.theorems, ts.statements, source)
		}
		// A line break after the word keeps the TypeScript reading.
		// The check needs every theorem word followed by a plain space, so
		// that the replacement breaks each one.
		if broken := strings.ReplaceAll(source, "theorem ", "theorem\n"); broken != source && strings.Count(source, "theorem") == strings.Count(source, "theorem ") && !strings.Contains(source, "\\u") {
			if after := collectTheoremSyntax(parseTheoremSource("/app/src/main.vibe", broken), broken); len(after.theorems) != 0 {
				t.Errorf("%s\ntheorems %v after a line break:\n%s", theoremLineBreakQuote, after.theorems, broken)
			}
		}
	})
}

// A theoremHeader is one header form and the rule it breaks, or 0.
type theoremHeader struct {
	head string
	rule int32
}

var theoremHeaders = []theoremHeader{
	{"theorem t(n: number)", 0},
	{"theorem t<T>(n: number, x: readonly T[])", 0},
	{"export theorem t(n: number)", 4302},
	{"theorem t(n: number): void", 4303},
	{"theorem t(n: number, m?: number)", 4303},
	{"theorem t(n: number, m: number = 1)", 4303},
	{"theorem t(n: number, ...ms: number[])", 4303},
	{"theorem t(n: number, { m }: { m: number })", 4303},
}

// A theoremStatement is one body statement form. text takes the statement's
// index for fresh names.
type theoremStatement struct {
	name    string
	text    func(i int) string
	assume  bool  // a direct assume
	asserts bool  // it holds an assert of the theorem
	rule    int32 // the rule it breaks wherever it stands, or 0
}

var theoremStatements = []theoremStatement{
	{name: "assume", text: func(int) string { return "  assume(n >= 0)\n" }, assume: true},
	{name: "assert", text: func(int) string { return "  assert(n === n)\n" }, asserts: true},
	{name: "const", text: func(i int) string { return fmt.Sprintf("  const a%d = n + 1\n  assert(a%d > n)\n", i, i) }, asserts: true},
	{name: "unused-const", text: func(i int) string { return fmt.Sprintf("  const u%d = n + 1\n", i) }, rule: 4305},
	{name: "if", text: func(int) string { return "  if (n > 0) assert(n > 0)\n" }, asserts: true},
	{name: "if-else", text: func(i int) string {
		return fmt.Sprintf("  if (n > 0) {\n    const c%d = n - 1\n    assert(c%d >= 0)\n  } else assert(n <= 0)\n", i, i)
	}, asserts: true},
	{name: "block", text: func(int) string { return "  {\n    assert(n <= n)\n  }\n" }, asserts: true},
	{name: "let", text: func(i int) string { return fmt.Sprintf("  let m%d = n\n", i) }, rule: 4305},
	{name: "loop", text: func(int) string { return "  while (n < 0) { }\n" }, rule: 4305},
	{name: "call", text: func(int) string { return "  f(n)\n" }, rule: 4305},
	{name: "nested-assume", text: func(int) string { return "  if (n > 0) assume(n > 1)\n" }, rule: 4305},
	// r takes the theorem's written return type, when a header has one
	// (rule 4303), so the body compares r with itself: it types under each.
	{name: "ensures", text: func(int) string { return "  ensures((r) => r === r)\n" }, rule: 4306},
	{name: "invariant", text: func(int) string { return "  invariant(n >= 0)\n" }, rule: 4306},
	{name: "decreases", text: func(int) string { return "  decreases(n)\n" }, rule: 4306},
	{name: "nested-decreases", text: func(int) string { return "  if (n > 0) decreases(n)\n" }, rule: 4306},
	{name: "proof-block", text: func(int) string { return "  proof {\n    assert(n === n)\n  }\n" }, rule: 4304},
	{name: "procedure-assert", text: func(int) string { return "  assert(f(n) >= 0 || n < 0)\n" }, asserts: true, rule: 4308},
	{name: "procedure-const", text: func(i int) string {
		return fmt.Sprintf("  const p%d = f(n)\n  assert(p%d >= 0 || p%d < 0)\n", i, i, i)
	}, asserts: true},
	{name: "procedure-nested-const", text: func(i int) string {
		return fmt.Sprintf("  if (n > 0) {\n    const q%d = f(n)\n    assert(q%d >= 0 || q%d < 0)\n  }\n", i, i, i)
	}, asserts: true, rule: 4308},
	{name: "remainder", text: func(int) string { return "  assert(n % 2 === 0 || n % 2 !== 0)\n" }, asserts: true, rule: 4311},
	{name: "transparent-call", text: func(int) string { return "  assert(twice(n) === n + n)\n" }, asserts: true},
	{name: "quantifier", text: func(int) string { return "  assert([n, n].every((x, i) => x === n && i >= 0))\n" }, asserts: true},
}

// theoremProgram is the program whose theorem has header and statements, and
// the rules the specification gives it, sorted.
func theoremProgram(header theoremHeader, statements []int) (string, []int32) {
	rules := map[int32]bool{}
	if header.rule != 0 {
		rules[header.rule] = true
	}
	var body strings.Builder
	other, asserts := false, false
	for i, choice := range statements {
		statement := theoremStatements[choice]
		body.WriteString(statement.text(i))
		if statement.rule != 0 {
			rules[statement.rule] = true
		}
		if statement.assume {
			if other {
				rules[4305] = true // an assume after the first other statement
			}
			continue
		}
		other = true
		asserts = asserts || statement.asserts
	}
	if !asserts {
		rules[4305] = true // a theorem with no assert
	}
	var want []int32
	for rule := range rules {
		want = append(want, rule)
	}
	slices.Sort(want)
	return theoremProgramBase + header.head + " {\n" + body.String() + "}\n", want
}

// theoremProgramBase declares f, a procedure, because it has a loop, and
// twice, a transparent function.
const theoremProgramBase = "export function f(n: number): number {\n  let total = 0\n  for (let i = 0; i < n; i++) {\n    total += i\n  }\n  return total\n}\nexport function twice(n: number): number {\n  return n + n\n}\n"

func FuzzTheoremRules(f *testing.F) {
	startShortBudget(f)
	for _, quote := range theoremQuotes {
		chapterSays(f, "900-appendices.md", quote)
	}
	// Each header with one assert, each statement alone and after an assert,
	// and an assume after another statement.
	for header := range theoremHeaders {
		f.Add([]byte{byte(header), 1})
	}
	for statement := range theoremStatements {
		f.Add([]byte{0, byte(statement)})
		f.Add([]byte{0, 1, byte(statement)})
		f.Add([]byte{0, byte(statement), 0, 1})
	}
	f.Add([]byte{0})
	f.Add([]byte{1, 0, 0, 2, 4, 5, 17, 20, 21})
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 || len(data) > 9 {
			return
		}
		header := theoremHeaders[int(data[0])%len(theoremHeaders)]
		var statements []int
		for _, b := range data[1:] {
			statements = append(statements, int(b)%len(theoremStatements))
		}
		source, want := theoremProgram(header, statements)
		with, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer with.Remove()
		var got []int32
		for _, d := range with.Diagnostics {
			if d.Category() == diagnostics.CategoryError && !slices.Contains(got, d.Code()) {
				got = append(got, d.Code())
			}
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Fatalf("%s / %s / %s / %s\nwant rules %v, got %v: %v\n%s", theoremHeaderQuote, theoremBodyQuote, theoremAssertQuote, theoremContractQuote, want, got, Keys(with.Dir, with.Diagnostics), source)
		}
		if len(want) != 0 {
			return
		}
		without, err := w.Compile(context.Background(), Single(theoremProgramBase))
		if err != nil {
			t.Fatal(err)
		}
		defer without.Remove()
		for _, output := range []string{"out/main.js", "out/main.d.ts"} {
			if with.Outputs[output] != without.Outputs[output] {
				t.Fatalf("%s\n%s differs:\n%s\nwithout the theorem:\n%s\nsource:\n%s", proofErasureJSQuote, output, with.Outputs[output], without.Outputs[output], source)
			}
		}
	})
}
