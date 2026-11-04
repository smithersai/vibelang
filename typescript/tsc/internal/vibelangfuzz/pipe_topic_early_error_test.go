package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"
)

// VIP-23's pipe adopts the pinned proposal's two topic early errors: a body
// with no topic and a topic outside every pipe body. Appendix B gives both
// EK2301, the code for the adopted pipe early errors without a more specific
// code. The controls are the same expressions with the topic supplied or the
// expression moved into a pipe body; they must compile without errors.

const pipeTopicEarlyErrorTarget = "FuzzPipeTopicEarlyError"
const pipeTopicAppendixQuote = "adopted pipe grammar and early errors without a more specific code, including a missing topic"
const pipeTopicChapterQuote = "These adopted pipe grammar and early errors use `EK2301` unless a more specific code applies"
const pipeTopicMissingQuote = "A pipe body **must** use its topic value **at least once**."
const pipeTopicStrayQuote = "Using a topic reference outside of a pipe body\nis also **invalid syntax**."

func TestPipeTopicEarlyErrorQuoted(t *testing.T) { pipeTopicQuoted(t) }

func pipeTopicQuoted(tb testing.TB) {
	tb.Helper()
	r3Quoted(tb, "900-appendices.md", pipeTopicAppendixQuote)
	r3Quoted(tb, "002-running.md", pipeTopicChapterQuote)
	text, err := os.ReadFile(SpecPath("../vips/tc39-pipeline-operator/explainer.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, q := range []string{pipeTopicMissingQuote, pipeTopicStrayQuote} {
		if !strings.Contains(string(text), q) {
			tb.Fatalf("pinned pipe snapshot no longer says %q", q)
		}
	}
}

// pipeTopicShape is one expression with a topic error and its control.
type pipeTopicShape struct{ name, bad, control string }

var pipeTopicShapes = []pipeTopicShape{
	{"missing-call", "1 |> f()", "1 |> [f(), %][1]"},
	{"missing-string", `1 |> "anonymous"`, `1 |> ["anonymous", %][1]`},
	{"missing-percent-string", `1 |> "%"`, `1 |> ["%", %][1]`},
	{"missing-number", "1 |> 7", "1 |> [7, %][1]"},
	{"missing-member", "1 |> o.k", "1 |> [o.k, %][1]"},
	{"missing-template", "1 |> `t`", "1 |> [`t`, %][1]"},
	{"missing-array", "1 |> [1, 2]", "1 |> [1, 2, %][2]"},
	{"missing-object", "1 |> ({ a: 1 })", "1 |> ({ a: 1, b: % }).b"},
	{"missing-unary", "1 |> -7", "1 |> -7 + %"},
	{"missing-binary", "1 |> f() + 1", "1 |> f() + %"},
	{"missing-nested-inner-only", "1 |> (2 |> % + 1)", "1 |> (% |> % + 1)"},
	{"missing-chained-second", "1 |> % + 1 |> 3", "1 |> % + 1 |> % + 3"},
	{"stray-divide", "% / 2", "4 |> % / 2"},
	{"stray-array", "[%][0]", "4 |> [%][0]"},
	{"stray-argument", "g(%)", "4 |> g(%)"},
	{"stray-template", "`${%}`.length", "4 |> `${%}`.length"},
	{"stray-object", "({ a: % }).a", "4 |> ({ a: % }).a"},
	{"stray-unary", "-%", "4 |> -%"},
}

var pipeTopicContexts = []struct{ name, before, after string }{
	{"module", "export const v = ", "\n"},
	{"plain", "export function h(n: number) { return ", " }\n"},
	{"arrow", "export const h = (n: number) => ", "\n"},
	{"effect", "export effect function h(n: number) { return ", " }\n"},
}

const pipeTopicPrelude = "declare function f(): number\ndeclare function g(x: number): number\ndeclare const o: { k: number }\n"

func pipeTopicInput(data []byte) (pipeTopicShape, int) {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		shape, context, _ := strings.Cut(key, "/")
		i := slices.IndexFunc(pipeTopicShapes, func(s pipeTopicShape) bool { return s.name == shape })
		j := slices.IndexFunc(pipeTopicContexts, func(c struct{ name, before, after string }) bool { return c.name == context })
		if i >= 0 && j >= 0 {
			return pipeTopicShapes[i], j
		}
	}
	if len(data) == 0 {
		return pipeTopicShapes[0], 0
	}
	context := 0
	if len(data) > 1 {
		context = int(data[1]) % len(pipeTopicContexts)
	}
	return pipeTopicShapes[int(data[0])%len(pipeTopicShapes)], context
}

func FuzzPipeTopicEarlyError(f *testing.F) {
	startShortBudget(f)
	pipeTopicQuoted(f)
	for _, s := range pipeTopicShapes {
		f.Add([]byte("key:" + s.name + "/module"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		shape, c := pipeTopicInput(data)
		context := pipeTopicContexts[c]
		key := shape.name + "/" + context.name
		compile := func(expression string) []string {
			t.Helper()
			source := pipeTopicPrelude + context.before + expression + context.after
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			return r3Errors(r.Diagnostics)
		}
		if errs := compile(shape.control); len(errs) > 0 {
			Gap(t, pipeTopicEarlyErrorTarget, "control:"+key, "%s must compile, reports %v", shape.control, errs)
			return
		}
		errs := compile(shape.bad)
		quote := pipeTopicMissingQuote
		if strings.HasPrefix(shape.name, "stray-") {
			quote = pipeTopicStrayQuote
		}
		if !slices.Contains(errs, "EK2301") || slices.Contains(errs, "EK1006") || slices.Contains(errs, "EK1007") {
			Gap(t, pipeTopicEarlyErrorTarget, "code:"+key, "Appendix B gives EK2301 to %q; the pinned snapshot says %q; %s reports %v",
				pipeTopicAppendixQuote, quote, shape.bad, errs)
		}
		if len(errs) != 1 {
			Gap(t, pipeTopicEarlyErrorTarget, "extra:"+key, "%s should report EK2301 alone, reports %v", shape.bad, errs)
		}
	})
}
