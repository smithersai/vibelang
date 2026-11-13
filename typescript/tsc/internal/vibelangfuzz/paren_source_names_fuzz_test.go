package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzParenthesizedSourceNames checks that parentheses, and the type
// operators TypeScript erases to them, keep the name a binding gives a value.
// Chapter 1: "Parentheses alone do not suppress source name inference", and a
// value-only evaluation gains no name. Chapter 7: formatting, which removes
// redundant parentheses, never changes function names.
//
// A function value (an effect arrow, an effect function expression, an arrow,
// a class) takes the binding name under ECMAScript NamedEvaluation and loses
// it as a comma operand. Which name the function generated for an effect
// block carries is the choice of the compiler, so the oracle for a block is
// relative: the wrapped block runs under the name the bare block runs under
// in the same position. A block reports the stack frame of its own code.
//
// The key is <form>/<wrapper>/<context>/<host>: the value, how it is wrapped,
// the position that names it, and whether that position is at the top level,
// in a plain function, in an effect function or in a do expression.

const regionCaptureSourceNamesQuote = "A value-only evaluation of an anonymous function or class cannot gain a name from a private variable or assignment; preserve a name the source explicitly requests."

const parenNamesTarget = "FuzzParenthesizedSourceNames"

var parenNamesQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "Generated captures preserve the source [NamedEvaluation]"},
	{"001-functions.md", "Parentheses alone do not suppress source name inference."},
	{"001-functions.md", regionCaptureSourceNamesQuote},
	{"007-tooling.md", "This source-text boundary never permits changes to ordinary strings/data, tagged-template raw or cooked values, regex meaning, function names or lengths, property names or directive semantics."},
}

type parenNamesForm struct {
	name, value, typ string
	block            bool
}

var parenNamesForms = []parenNamesForm{
	{"block", "effect { return frameName(new Error().stack) }", "Effect.Effect<string>", true},
	{"effect-arrow", "effect () => 1", "() => Effect.Effect<number>", false},
	{"effect-function", "effect function () { return 1 }", "() => Effect.Effect<number>", false},
	{"arrow", "() => 1", "() => number", false},
	{"class", "class {}", "new () => object", false},
}

// bare is the control: a block cell compares its wrapper with it.
var parenNamesWrappers = []struct{ name, template string }{
	{"bare", "{V}"},
	{"paren", "({V})"},
	{"double-paren", "(({V}))"},
	{"as", "({V}) as {T}"},
	{"satisfies", "({V}) satisfies {T}"},
	{"comma", "(touch(), {V})"},
}

// Each context binds the wrapped value {W} as target; ref reads it back.
var parenNamesContexts = []struct{ name, decl, ref string }{
	{"const", "const target = {W}", "target"},
	{"assign", "let target: {T}\ntarget = {W}", "target"},
	{"logical", "let target: ({T}) | undefined = undefined\ntarget ??= {W}", "target!"},
	{"property", "const o = { target: {W} }", "o.target"},
	{"field", "class C { target = {W} }", "new C().target"},
	{"static-field", "class C { static target = {W} }", "C.target"},
	{"default-param", "const f = (target: {T} = {W}) => target", "f()"},
	{"object-default", "const { target = {W} }: { target?: {T} } = {}", "target"},
	{"array-default", "const [target = {W}]: (({T}) | undefined)[] = []", "target"},
}

var parenNamesHosts = []string{"top", "plain", "effect", "do"}

// frameName reads the name of the function that created the stack: the first
// frame below the message line, without a receiver prefix.
const parenNamesHeader = `import * as Effect from "effect/Effect"
const touch = () => {}
const frameName = (stack: string | undefined): string => {
  const line = (stack ?? "").split("\n")[1] ?? ""
  const m = /^\s*at (?:async )?(\S+) \(/.exec(line)
  return m ? m[1].slice(m[1].lastIndexOf(".") + 1) : ""
}
`

type parenNamesCase struct {
	key     string
	form    parenNamesForm
	wrapper string
	wrap    string
	context int
	host    string
}

func parenNamesCases() []parenNamesCase {
	var cases []parenNamesCase
	for _, f := range parenNamesForms {
		for _, w := range parenNamesWrappers {
			if f.block && w.name == "bare" {
				continue
			}
			for i, c := range parenNamesContexts {
				for _, h := range parenNamesHosts {
					cases = append(cases, parenNamesCase{key: f.name + "/" + w.name + "/" + c.name + "/" + h, form: f, wrapper: w.name, wrap: w.template, context: i, host: h})
				}
			}
		}
	}
	return cases
}

func parenNamesIndent(text, prefix string) string {
	return prefix + strings.ReplaceAll(text, "\n", "\n"+prefix)
}

// source is the cell program with the value wrapped by template.
func (c parenNamesCase) source(template string) string {
	wrapped := strings.NewReplacer("{V}", c.form.value, "{T}", c.form.typ).Replace(template)
	ctx := parenNamesContexts[c.context]
	decl := strings.NewReplacer("{W}", wrapped, "{T}", c.form.typ).Replace(ctx.decl)
	observe := ctx.ref + ".name"
	if c.form.block {
		observe = ctx.ref
		if c.host == "effect" {
			observe = "try " + ctx.ref
		}
	}
	switch c.host {
	case "top":
		return parenNamesHeader + decl + "\nexport function probe() { return " + observe + " }\n"
	case "plain":
		return parenNamesHeader + "export function probe() {\n" + parenNamesIndent(decl, "  ") + "\n  return " + observe + "\n}\n"
	case "do":
		return parenNamesHeader + "export function probe() {\n  return do {\n" + parenNamesIndent(decl, "    ") + "\n    " + observe + "\n  }\n}\n"
	}
	return parenNamesHeader + "export effect function probe() {\n" + parenNamesIndent(decl, "  ") + "\n  return " + observe + "\n}\n"
}

// gapKey is the pending key of a cell. The hosts of a block wrapper and
// context share one verdict.
func (c parenNamesCase) gapKey() string {
	if c.form.block {
		return c.form.name + "/" + c.wrapper + "/" + parenNamesContexts[c.context].name
	}
	return c.key
}

// parenNamesRun runs probe from one emitted module and returns the name it
// observed, or reports why it observed none.
func parenNamesRun(t *testing.T, node *Node, r *Result, file, key string, files map[string]string) (string, bool) {
	t.Helper()
	out := node.Run(r, file, "probe")
	if out.Kind != "plain" && out.Kind != "success" {
		Gap(t, parenNamesTarget, key, "Chapter 1: the program must run and report a name; %s ended %s: %s\n%s", file, out.Kind, out.Log, Archive(files))
		return "", false
	}
	var name string
	if err := json.Unmarshal(out.Value, &name); err != nil {
		t.Fatalf("%s returned %s, not a name", file, out.Value)
	}
	return name, true
}

func checkParenNames(t *testing.T, w *Workspace, node *Node, c parenNamesCase) {
	t.Helper()
	files := map[string]string{"main.vibe": c.source(c.wrap)}
	if c.form.block {
		files["control.vibe"] = c.source("{V}")
	}
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var errs []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errs = append(errs, describe(d))
		}
	}
	// Every generated program is well typed, so any error is a gap.
	if len(errs) > 0 {
		Gap(t, parenNamesTarget, c.gapKey(), "every generated program is well typed, but %s reports: %s\n%s", c.key, strings.Join(errs, "; "), Archive(files))
		return
	}
	got, ok := parenNamesRun(t, node, r, "out/main.js", c.gapKey(), files)
	if !ok {
		return
	}
	switch {
	case c.form.block && c.wrapper == "comma":
		if got == "target" {
			Gap(t, parenNamesTarget, c.gapKey(), "Chapter 1: %q; a comma operand is value-only, but the block runs as %q\n%s", regionCaptureSourceNamesQuote, got, Archive(files))
		}
	case c.form.block:
		want, ok := parenNamesRun(t, node, r, "out/control.js", c.gapKey(), files)
		if ok && got != want {
			Gap(t, parenNamesTarget, c.gapKey(), "Chapter 1: \"Parentheses alone do not suppress source name inference.\" Chapter 7: formatting never changes function names. The %s block runs as %q, the bare block in the same position as %q\n%s", c.wrapper, got, want, Archive(files))
		}
	case c.wrapper == "comma":
		if got != "" {
			Gap(t, parenNamesTarget, c.gapKey(), "Chapter 1: %q; a comma operand gains no name, but name is %q\n%s", regionCaptureSourceNamesQuote, got, Archive(files))
		}
	default:
		if got != "target" {
			Gap(t, parenNamesTarget, c.gapKey(), "Chapter 1: NamedEvaluation names the %s value target through %s; name is %q\n%s", c.form.name, c.wrapper, got, Archive(files))
		}
	}
	ExpectPending(t, parenNamesTarget, c.gapKey())
}

func TestParenthesizedSourceNamesQuoted(t *testing.T) {
	for _, q := range parenNamesQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

func parenNamesNode(tb testing.TB, w *Workspace) *Node {
	tb.Helper()
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(tb, "%v", err)
	}
	tb.Cleanup(node.Close)
	return node
}

// TestParenthesizedSourceNamesWitness runs the recovery program of alchemy
// prisma as written, with its effect block in parentheses, and as
// vibelang-format writes it, without them. Chapter 7: both run under the
// same name.
func TestParenthesizedSourceNamesWitness(t *testing.T) {
	TestParenthesizedSourceNamesQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-paren-effect-block-name.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main, Formatted string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	const key = "witness:alchemy-paren-effect-block-name"
	files := map[string]string{"main.vibe": witness.Main, "formatted.vibe": witness.Formatted}
	w := NewWorkspace(t)
	node := parenNamesNode(t, w)
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			Gap(t, parenNamesTarget, key, "%s: the witness is well typed, but the compiler reports %s\n%s", witness.Source, describe(d), Archive(files))
			return
		}
	}
	written, ok := parenNamesRun(t, node, r, "out/main.js", key, files)
	if !ok {
		return
	}
	formatted, ok := parenNamesRun(t, node, r, "out/formatted.js", key, files)
	if !ok {
		return
	}
	if written != formatted || !strings.HasPrefix(formatted, "catchProgram:") {
		Gap(t, parenNamesTarget, key, "Chapter 7: formatting never changes function names; %s: as written it runs as %q, formatted as %q\n%s", witness.Source, written, formatted, Archive(files))
	}
	ExpectPending(t, parenNamesTarget, key)
}

func FuzzParenthesizedSourceNames(f *testing.F) {
	startShortBudget(f)
	cases := parenNamesCases()
	f.Add("block/paren/const/do")
	f.Add("block/as/property/top")
	f.Add("arrow/satisfies/logical/effect")
	w := NewWorkspace(f)
	node := parenNamesNode(f, w)
	f.Fuzz(func(t *testing.T, key string) {
		TestParenthesizedSourceNamesQuoted(t)
		i := slices.IndexFunc(cases, func(c parenNamesCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkParenNames(t, w, node, cases[i])
		ExpectPending(t, parenNamesTarget, specCorpusKey(t))
	})
}

func TestParenthesizedSourceNamesNeighborhood(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_PAREN_NAMES_MATRIX") == "" {
		t.Skip("the complete form, wrapper, context and host matrix runs separately")
	}
	TestParenthesizedSourceNamesQuoted(t)
	w := NewWorkspace(t)
	node := parenNamesNode(t, w)
	for _, c := range parenNamesCases() {
		t.Run(c.key, func(t *testing.T) { checkParenNames(t, w, node, c) })
	}
}
