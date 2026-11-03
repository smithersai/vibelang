package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const doContextualResultTarget = "FuzzDoContextualResult"

var doContextualResultQuotes = []struct{ chapter, quote string }{
	{"007-tooling.md", "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types."},
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
// `experimental/machine/machine.vibe` selectFromGuardList). The empty-array
// keys put `[]` beside a do ending in an array, in a match arm, an object
// property, a spread, an if/else and an inferred local: written in place,
// `[]` is an empty array literal, never the start of an evolving array
// (foldkit-122, Foldkit uiToastBasic and pixel-art, TS7034/TS7005). The
// prefix keys put `[]` and a tagged object literal in properties before a
// do, which the lowering evaluates first into temporaries.
func FuzzDoContextualResult(f *testing.F) {
	startShortBudget(f)
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	for _, key := range []string{"foldkit-edge-selection", "plain-conditional", "if-else", "nested-do", "switch-arms", "match-arms", "literal-union", "fresh-literal", "call-argument", "empty-array-match", "empty-array-property", "empty-array-spread", "empty-array-if-else", "empty-array-local", "empty-array-prefix-property", "prefix-tag", "foldkit-ui-toast", "foldkit-pixel-art-prefix"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(11))
	}
	for _, key := range []string{"foldkit-edge-selection", "plain-conditional", "if-else", "nested-do", "switch-arms", "match-arms", "call-argument"} {
		f.Add(key, uint8(16))
		f.Add(key, uint8(27))
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
		case "empty-array-match":
			source = "export const items = (n: 0 | 1): ReadonlyArray<string> => match (n) { when 0: []; when 1: do { const a = 'x'; " + wrap("[a, 'y']") + " }; }"
			counterpart = "export const items = (n: 0 | 1): ReadonlyArray<string> => { if (n === 0) { return [] } const a = 'x'; return [a, 'y'] }"
		case "empty-array-property":
			source = "export const view = (n: 0 | 1): Readonly<{ content: ReadonlyArray<string> }> => ({ content: match (n) { when 0: []; when 1: do { const a = 'x'; " + wrap("[a]") + " }; } })"
			counterpart = "export const view = (n: 0 | 1): Readonly<{ content: ReadonlyArray<string> }> => ({ content: n === 0 ? [] : ['x'] })"
		case "empty-array-spread":
			source = "export const items = (n: 0 | 1): ReadonlyArray<string> => ['head', ...match (n) { when 0: []; when 1: do { const a = 'x'; " + wrap("[a]") + " }; }]"
			counterpart = "export const items = (n: 0 | 1): ReadonlyArray<string> => ['head', ...(n === 0 ? [] : ['x'])]"
		case "empty-array-if-else":
			source = "export const items = (flag: boolean): ReadonlyArray<string> => do { if (flag) { [] } else { " + wrap("['x']") + " } }"
			counterpart = "export const items = (flag: boolean): ReadonlyArray<string> => { if (flag) { return [] } else { return ['x'] } }"
		case "empty-array-local":
			source = "export const count = (n: 0 | 1): number => { const items = match (n) { when 0: []; when 1: do { const a = 'x'; " + wrap("[a]") + " }; }; return items.length }"
			counterpart = "export const count = (n: 0 | 1): number => { const items = n === 0 ? [] : ['x']; return items.length }"
		case "empty-array-prefix-property":
			// Properties before a do run first, so the lowering evaluates
			// them into temporaries; each is still typed where it was written.
			source = "export const view = (n: 0 | 1): Readonly<{ before: ReadonlyArray<string>; after: ReadonlyArray<string> }> => ({ before: [], after: match (n) { when 0: []; when 1: do { const a = 'x'; " + wrap("[a]") + " }; } })"
			counterpart = "export const view = (n: 0 | 1): Readonly<{ before: ReadonlyArray<string>; after: ReadonlyArray<string> }> => ({ before: [], after: n === 0 ? [] : ['x'] })"
		case "prefix-tag":
			source = types + "export const pair = (condition: boolean): Readonly<{ first: Selection; second: Selection }> => ({ first: " + selected + ", second: do { " + wrap(conditional) + " } })"
			counterpart = types + "export const pair = (condition: boolean): Readonly<{ first: Selection; second: Selection }> => ({ first: " + selected + ", second: " + conditional + " })"
		case "foldkit-pixel-art-prefix":
			// Foldkit Pixel Art's init, minimized by drive-foldkit-examples:
			// empty undo and redo stacks before the grid's do arm.
			for name, text := range map[string]*string{"foldkit-pixel-art-adjacent-empty-arrays.vibe": &source, "foldkit-pixel-art-adjacent-empty-arrays.ts": &counterpart} {
				raw, err := os.ReadFile(filepath.Join("testdata", "do-contextual", name))
				if err != nil {
					t.Fatal(err)
				}
				*text = string(raw)
			}
		case "foldkit-ui-toast":
			// Foldkit uiToastBasic's minimized pattern (drive-foldkit-web) and
			// its TypeScript original.
			for name, text := range map[string]*string{"foldkit-ui-toast-property-do-array.vibe": &source, "foldkit-ui-toast-property-do-array.ts": &counterpart} {
				raw, err := os.ReadFile(filepath.Join("testdata", "do-contextual", name))
				if err != nil {
					t.Fatal(err)
				}
				*text = string(raw)
			}
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
		if variant&16 != 0 {
			before := "{ " + tag + ": 'SelectedEdge'"
			wrong := "{ " + tag + ": 'MissingEdge'"
			if strings.Contains(source, before) && strings.Contains(counterpart, before) {
				source = strings.ReplaceAll(source, before, wrong)
				counterpart = strings.ReplaceAll(counterpart, before, wrong)
				native := doContextualNegativeCodes(t, w, "main.ts", counterpart)
				if !slices.Contains(native, "TS2322") && !slices.Contains(native, "TS2345") {
					t.Fatalf("invalid native wrong-tag control: %v\n%s", native, counterpart)
				}
				actual := doContextualNegativeCodes(t, w, "main.vibe", source)
				gap := fmt.Sprintf("wrong-tag:%s:depth-%d:polarity-%t:%s", key, depth, polarity, tag)
				if !slices.Equal(actual, native) {
					Gap(t, doContextualResultTarget, gap, "Chapter2 contextual result alternatives retain their written context; Chapter7 keeps native TS codes. Native %v, Vibe %v\n%s\n%s", native, actual, source, counterpart)
				}
				ExpectPending(t, doContextualResultTarget, gap)
				ExpectPending(t, doContextualResultTarget, specCorpusKey(t))
				return
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

// The compiler is compared with itself on the ordinary TypeScript counterpart:
// Chapter2 requires the same source context, and Chapter7 retains TS codes.
func doContextualNegativeCodes(t *testing.T, w *Workspace, name, source string) []string {
	t.Helper()
	var result *Result
	var err error
	within(t, "compile", func() {
		result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}, Config: fmt.Sprintf(errorTwinConfig, name)})
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var codes []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		prefix := d.Source()
		if prefix == "" {
			prefix = "TS"
		}
		codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}
