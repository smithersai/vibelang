package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// FuzzEffectBlockLint enforces Appendix A, EffectBlock: "The braces hold a
// function body, as `(effect () => { … })()` does", so `effect { return 1 }`
// is a whole expression whose braces are its syntax. Chapter 7 assigns
// `effecttsgo/unnecessaryArrowBlock` (D240's port, EK4823) to an arrow whose
// block only returns a value; an effect block parses as an arrow but has no
// concise form, so the rule never reports one. The input picks a context (a
// top-level constant, an Effect function's `try`, a call argument in an
// Effect function, an `if` branch, an array, an object, a nested block, a
// plain function's return, a class field) and a body (a lone return of a
// value, of a `try`, of a nested block, with a comment, over lines; two
// statements; a real arrow inside; an effect arrow a block defines and
// runs). A call at the top level runs a program (EK1001), so no context
// calls there. The oracle counts the arrows the generator writes: each real
// arrow whose block only returns draws the code once, and no effect block
// draws it. alchemy's InMemory, Foldkit, Redis Protocol and Model each need a
// single-return effect block (corpus alchemy-effect-block-arrow-lint).
func FuzzEffectBlockLint(f *testing.F) {
	startShortBudget(f)
	effectBlockLintChapters(f)
	for _, body := range effectBlockBodies {
		f.Add([]byte("effect-block-lint:top-const/" + body.name))
	}
	for _, ctx := range effectBlockContexts[1:] {
		f.Add([]byte("effect-block-lint:" + ctx.name + "/return"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		ctx, body := parseEffectBlockLint(data)
		CheckEffectBlockLint(t, w, ctx, body)
	})
}

// TestEffectBlockLintQuoted fails when a chapter rewords a sentence the
// oracle quotes (RULES.md 9).
func TestEffectBlockLintQuoted(t *testing.T) { effectBlockLintChapters(t) }

var effectBlockLintQuotes = map[string][]string{
	"900-appendices.md": {"The braces hold a function body, as `(effect () => { … })()` does"},
	"007-tooling.md":    {"| `EK38123` | `effecttsgo/unnecessaryArrowBlock` |"},
}

func effectBlockLintChapters(tb testing.TB) {
	tb.Helper()
	for chapter, quotes := range effectBlockLintQuotes {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			tb.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(text), quote) {
				tb.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// An effectBlockContext places X, an expression of type number!!, once or
// more; uses is how many times.
type effectBlockContext struct {
	name, text string
	uses       int
}

var effectBlockContexts = []effectBlockContext{
	{"top-const", "export const value = X", 1},
	{"effect-try", "export effect function run() {\n  return try X\n}", 1},
	{"call-argument", "export effect function run() {\n  return try Effect.map(X, (n: number) => n + 1)\n}", 1},
	{"if-branch", "export effect function run(flag: boolean) {\n  if (flag) {\n    return try X\n  }\n  return 0\n}", 1},
	{"array", "export const all = [X, X]", 2},
	{"object", "export const holder = { run: X }", 1},
	{"nested", "export const outer = effect {\n  const inner = X\n  return try inner\n}", 1},
	{"plain-return", "export function make(): number!! {\n  return X\n}", 1},
	{"class-field", "export class Holder {\n  readonly run = X\n}", 1},
}

// An effectBlockBody is X: blocks counts its effect blocks and arrows the
// real arrows whose block only returns, per use.
type effectBlockBody struct {
	name, text     string
	blocks, arrows int
}

var effectBlockBodies = []effectBlockBody{
	{"return", "effect { return 1 }", 1, 0},
	{"return-try", "effect { return try Effect.succeed(1) }", 1, 0},
	{"return-nested", "effect { return try effect { return 2 } }", 2, 0},
	{"return-comment", "effect {\n  // only a return\n  return 3\n}", 1, 0},
	{"return-lines", "effect {\n  return [1, 2].length\n}", 1, 0},
	{"two-statements", "effect {\n  const n = 1\n  return n\n}", 1, 0},
	{"arrow-inside", "effect {\n  const add = (n: number): number => { return n + 1 }\n  return add(1)\n}", 1, 1},
	{"effect-arrow", "effect {\n  const four = effect () => { return 4 }\n  return try four()\n}", 1, 1},
}

// parseEffectBlockLint reads the keyed form, `effect-block-lint:<context>/<body>`,
// so a saved corpus file keeps what it tests (RULES.md 11), and otherwise
// picks both from the first two bytes.
func parseEffectBlockLint(data []byte) (effectBlockContext, effectBlockBody) {
	if rest, ok := strings.CutPrefix(string(data), "effect-block-lint:"); ok {
		ctxName, bodyName, _ := strings.Cut(rest, "/")
		ctx, body := effectBlockContexts[0], effectBlockBodies[0]
		for _, c := range effectBlockContexts {
			if c.name == ctxName {
				ctx = c
			}
		}
		for _, b := range effectBlockBodies {
			if b.name == bodyName {
				body = b
			}
		}
		return ctx, body
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return effectBlockContexts[at(0)%len(effectBlockContexts)], effectBlockBodies[at(1)%len(effectBlockBodies)]
}

const effectBlockLintConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"vibe":{"severities":{"EK38123":"error"}}}`

// CheckEffectBlockLint compiles one program with the rule on as an error and
// counts its reports.
func CheckEffectBlockLint(t *testing.T, w *Workspace, ctx effectBlockContext, body effectBlockBody) {
	const target = "FuzzEffectBlockLint"
	defer recoverCompilerPanic(t, target)
	source := "import { Effect } from \"effect\"\n\n" + strings.ReplaceAll(ctx.text, "X", body.text) + "\n"
	g := &Gaps{Target: target, Input: source}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: effectBlockLintConfig})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	reports, others := 0, []string{}
	for _, d := range r.Diagnostics {
		switch {
		case IsEK(d) && (d.Code() == 4823 || d.Code() == 38123):
			reports++
		case d.Category().Name() == "error":
			others = append(others, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
	}
	if len(others) != 0 {
		g.Add("feature:effect-block-lint-compiles", "Appendix A: an effect block is a PrimaryExpression; this program is valid but reports:\n%s\n%s", strings.Join(others, "\n"), source)
		g.FinishInput(t, key)
		return
	}
	if want := body.arrows * ctx.uses; reports != want {
		g.Add("feature:effect-block-lint", "Appendix A: \"The braces hold a function body\", so an effect block has no concise form and only an arrow whose block only returns draws effecttsgo/unnecessaryArrowBlock: want %d reports (%d arrows, %d effect blocks), got %d for:\n%s", want, body.arrows*ctx.uses, body.blocks*ctx.uses, reports, source)
	}
	g.FinishInput(t, key)
}
