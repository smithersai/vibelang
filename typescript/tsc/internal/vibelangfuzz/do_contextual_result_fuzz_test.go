package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

const doContextualResultTarget = "FuzzDoContextualResult"

var doContextualResultQuotes = []struct{ chapter, quote string }{
	{"002-running.md", "Contextual typing reaches only the expression alternatives contributing to the normal result; discarded intermediate expressions and outward returns retain their own source contexts."},
	{"002-running.md", "`const exact = do { 1 }` has type `1`, while `let ordinary = do { 1 }` widens to `number`"},
}

func TestDoContextualResultFuzzQuoted(t *testing.T) {
	for _, rule := range doContextualResultQuotes {
		if !contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q; update the oracle", rule.chapter, rule.quote)
		}
	}
}

func contains(text, quote string) bool {
	return len(quote) == 0 || len(text) >= len(quote) && indexOf(text, quote) >= 0
}

func indexOf(text, quote string) int {
	for i := 0; i+len(quote) <= len(text); i++ {
		if text[i:i+len(quote)] == quote {
			return i
		}
	}
	return -1
}

// FuzzDoContextualResult compares a do expression whose value's alternatives
// need the contextual type of the do's site (a discriminated union's literal
// tags, a literal union, a fresh literal) with the same alternatives written
// in place in TypeScript, as chapter 002 says they are typed: the VibeLang
// source must compile, and its declaration bytes must equal stock
// TypeScript's emit of the counterpart. The alternatives sit in a conditional,
// an if/else, a switch, a match arm, a nested do, a call argument and a
// return, at every do depth up to three (foldkit-121,
// `experimental/machine/machine.vibe` selectFromGuardList).
func FuzzDoContextualResult(f *testing.F) {
	startShortBudget(f)
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	for _, key := range []string{"foldkit-edge-selection", "plain-conditional", "if-else", "nested-do", "switch-arms", "match-arms", "literal-union", "fresh-literal", "call-argument"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(11))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDoContextualResultFuzzQuoted(t)
		defer recoverCompilerPanic(t, doContextualResultTarget)
		polarity := variant&1 != 0
		depth := int(variant>>1) % 4
		tag := "_tag"
		if variant&8 != 0 {
			tag = "kind"
		}
		wrap := func(body string) string {
			for i := 0; i < depth; i++ {
				body = "(do { " + body + " })"
			}
			return body
		}
		selected, ignored := "{ "+tag+": 'SelectedEdge', value: 1 }", "{ "+tag+": 'IgnoredEdge', reason: 'GuardFailed' }"
		if polarity {
			selected, ignored = ignored, selected
		}
		types := "type Selection =\n  | { readonly " + tag + ": 'SelectedEdge'; readonly value: number }\n  | { readonly " + tag + ": 'IgnoredEdge'; readonly reason: 'GuardFailed' }\n"
		edge := "\ntype Edge =\n  | { readonly " + tag + ": 'When'; readonly condition: boolean }\n  | { readonly " + tag + ": 'Otherwise' }\n"
		conditional := "condition ? " + selected + " : " + ignored
		var source, counterpart string
		switch key {
		case "plain-conditional":
			source = types + "export const select = (condition: boolean): Selection => do { " + wrap(conditional) + " }"
			counterpart = types + "export const select = (condition: boolean): Selection => " + conditional
		case "if-else":
			source = types + "export const select = (condition: boolean): Selection => do { if (condition) { (" + selected + ") } else { " + wrap("("+ignored+")") + " } }"
			counterpart = types + "export const select = (condition: boolean): Selection => { if (condition) { return " + selected + " } else { return " + ignored + " } }"
		case "nested-do":
			source = types + "export const select = (condition: boolean): Selection => do { const chosen = condition; (do { " + wrap("chosen ? "+selected+" : "+ignored) + " }) }"
			counterpart = types + "export const select = (condition: boolean): Selection => { const chosen = condition; return chosen ? " + selected + " : " + ignored + " }"
		case "switch-arms":
			source = types + "export const select = (n: number): Selection => do { switch (n) { case 0: { (" + selected + "); break } default: { " + wrap("("+ignored+")") + " } } }"
			counterpart = types + "export const select = (n: number): Selection => { switch (n) { case 0: { return " + selected + " } default: { return " + ignored + " } } }"
		case "match-arms":
			source = types + "export const select = (n: 0 | 1): Selection => match (n) { when 0: do { (" + selected + ") }; when 1: " + wrap("("+ignored+")") + "; }"
			counterpart = types + "export const select = (n: 0 | 1): Selection => { if (n === 0) { return " + selected + " } return " + ignored + " }"
		case "literal-union":
			source = "export const letter = (flag: boolean): 'a' | 'b' => do { " + wrap("flag ? 'a' : 'b'") + " }"
			counterpart = "export const letter = (flag: boolean): 'a' | 'b' => flag ? 'a' : 'b'"
		case "fresh-literal":
			source = "const exact = do { " + wrap("1") + " }\nexport const exactCheck: 1 = exact\nlet ordinary = do { " + wrap("1") + " }\nordinary = 2\nexport const widened: number = ordinary"
			counterpart = "const exact = 1\nexport const exactCheck: 1 = exact\nlet ordinary = 1\nordinary = 2\nexport const widened: number = ordinary"
		case "call-argument":
			source = types + "declare function take(s: Selection): string\nexport const taken = (condition: boolean): string => take(do { " + wrap(conditional) + " })"
			counterpart = types + "declare function take(s: Selection): string\nexport const taken = (condition: boolean): string => take(" + conditional + ")"
		default:
			key = "foldkit-edge-selection"
			source = types + edge + "export const select = (edge: Edge): Selection =>\n  match (edge) {\n    when { " + tag + ": 'When' } and let guarded: do {\n      const condition = guarded.condition;\n      " + wrap(conditional) + "\n    };\n    when { " + tag + ": 'Otherwise' }: ({ " + tag + ": 'SelectedEdge', value: 0 });\n  }"
			counterpart = types + edge + "export const select = (edge: Edge): Selection => { if (edge." + tag + " === 'When') { const condition = edge.condition; return " + conditional + " } return { " + tag + ": 'SelectedEdge', value: 0 } }"
			if variant == 0 {
				raw, err := os.ReadFile(filepath.Join("testdata", "do-contextual", "foldkit-machine-edge-selection.vibe"))
				if err != nil {
					t.Fatal(err)
				}
				source = string(raw)
			}
		}
		project := Project{Files: map[string]string{"main.vibe": source}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}
		var c *Compilation
		var err error
		within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		gap := fmt.Sprintf("%s:depth-%d", key, depth)
		if c.Program == nil || HasError(c.Diagnostics) {
			Gap(t, doContextualResultTarget, "compile:"+gap, "Chapter 002: %s\n%v\n%s", doContextualResultQuotes[0].quote, SortedKeys(Keys(c.Dir, c.Diagnostics)), source)
		}
		stock := Project{Files: map[string]string{"main.ts": counterpart}, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		want, err := os.ReadFile(filepath.Join(dir, "__identity_out", "main.d.ts"))
		if err != nil {
			t.Fatal(err)
		}
		got, ok := c.Outputs["__identity_out/main.d.ts"]
		if !ok {
			t.Fatal("missing declaration output", c.Outputs)
		}
		if got != string(want) {
			Gap(t, doContextualResultTarget, "bytes:"+gap, "Chapter 002: %s\nstock TypeScript:\n%s\nVibeLang:\n%s\nsource:\n%s\ncounterpart:\n%s", doContextualResultQuotes[0].quote, want, got, source, counterpart)
		}
		ExpectPending(t, doContextualResultTarget, "compile:"+gap)
		ExpectPending(t, doContextualResultTarget, "bytes:"+gap)
		ExpectPending(t, doContextualResultTarget, specCorpusKey(t))
	})
}
