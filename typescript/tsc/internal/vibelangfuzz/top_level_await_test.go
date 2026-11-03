package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The rules TestTopLevelAwait checks, quoted from the chapters (foldkit-42:
// `export const answer = await Promise.resolve(42)` in a .vibe module was
// EK4602 and EK1001, and emitted $await).
var topLevelAwaitQuotes = []struct{ chapter, quote string }{
	{"001-functions.md", "- `await` at the top level is ES top-level await of a Promise. `await` on an Effect there is `EK0103`."},
	{"002-running.md", "`await`, `for await` and `await using` inside effect code are errors"},
}

func TestTopLevelAwaitQuoted(t *testing.T) {
	for _, q := range topLevelAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.quote) {
			t.Errorf("chapter %s no longer says %q; update the quote", q.chapter, q.quote)
		}
	}
}

// TestTopLevelAwait puts await of a Promise and of an Effect in each place
// a module's top level reaches without a function boundary (a declaration,
// a statement, a block, a for...of body, a try block) and in effect
// code at the top level and in a function. At the top level a Promise is
// awaited as JavaScript awaits it, and an Effect is EK0103; in effect code
// either is an error.
func TestTopLevelAwait(t *testing.T) {
	// Spec rule: docs/design/src/001-functions.md#3b7a39a57b1d2e71
	// Chapter 001: native Promise top-level await and EK0103 for an Effect (TestTopLevelAwait).

	// Spec rule: docs/design/src/001-functions.md#6d7a4af271928c19
	// Chapter 001: native Promise top-level await and EK0103 for an Effect (TestTopLevelAwait).

	w := NewWorkspace(t)
	operands := map[string]string{"promise": "Promise.resolve(1)", "effect": "Effect.succeed(1)"}
	topLevel := map[string]string{
		"declaration": "export const v = await {E}\n",
		"statement":   "await {E}\n",
		"block":       "if (Math.random() >= 0) { await {E} }\n",
		"for-of":      "for (const _ of [1]) { await {E} }\n",
		"try":         "try { await {E} } finally { }\n",
	}
	effectCode := map[string]string{
		"effect-function": "export effect function f() { return await {E} }\n",
		"effect-block":    "export const p = effect { return await {E} }\n",
	}
	check := func(t *testing.T, source string, want func(codes []int32, js string) string) {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []int32
		var texts []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
				texts = append(texts, specDiagnosticText(d))
			}
		}
		if problem := want(codes, r.Outputs["out/main.js"]); problem != "" {
			Gap(t, "TestTopLevelAwait", "top-level-await", "%s\n%s\nerrors: %v\n%s", problem, source, texts, r.Outputs["out/main.js"])
		}
	}
	for name, template := range topLevel {
		for operand, text := range operands {
			t.Run(name+"-"+operand, func(t *testing.T) {
				check(t, strings.ReplaceAll(template, "{E}", text), func(codes []int32, js string) string {
					if operand == "promise" {
						if len(codes) != 0 || !strings.Contains(js, "await Promise.resolve(1)") || strings.Contains(js, "$await") {
							return "a Promise awaited at the top level is ES top-level await, with no error"
						}
						return ""
					}
					// The legacy analyzer may add EK1001 for the Effect call itself (VIP-1 flip, core-land).
					if !slices.Contains(codes, 103) || strings.Contains(js, "$await") {
						return "an Effect awaited at the top level is EK0103, and the await stays ES await"
					}
					return ""
				})
			})
		}
	}
	for name, template := range effectCode {
		for operand, text := range operands {
			t.Run(name+"-"+operand, func(t *testing.T) {
				check(t, strings.ReplaceAll(template, "{E}", text), func(codes []int32, js string) string {
					if len(codes) == 0 {
						return "await in effect code is an error"
					}
					return ""
				})
			})
		}
	}
}

const topLevelAwaitTarget = "FuzzTopLevelAwait"

// VIP-26; foldkit-42.
const topLevelAwaitQuote = "A module's top level is ordinary JavaScript. `await` there is ES top-level await of a Promise (VIP-5), and `try` is not allowed, because a top level is not an `effect` function."

func TestTopLevelAwaitVIPQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0026-top-level-and-main.md"), topLevelAwaitQuote) {
		t.Fatalf("VIP-26 no longer says %q", topLevelAwaitQuote)
	}
}

type topLevelAwaitShape struct{ name, source string }

// Every shape is ordinary ES top-level await; the same bytes are the native
// control, so the oracle compares .vibe with TypeScript on identical text.
func topLevelAwaitShapes() []topLevelAwaitShape {
	return []topLevelAwaitShape{
		{"export-const", "export const answer = await Promise.resolve(42);\n"},
		{"const-then-export", "const value = await Promise.resolve(1);\nexport const answer = value + 1;\n"},
		{"export-default", "export default await Promise.resolve(\"x\");\n"},
		{"call-argument", "export const answer = Math.max(await Promise.resolve(1), 2);\n"},
		{"template", "export const answer = `${await Promise.resolve(1)}`;\n"},
		{"top-level-block", "let n = 0;\n{ n = await Promise.resolve(2); }\nexport const answer = n;\n"},
		{"conditional", "export const answer = (await Promise.resolve(true)) ? 1 : 2;\n"},
		{"for-await", "const out: number[] = [];\nfor await (const v of [Promise.resolve(1)]) { out.push(v); }\nexport const answer = out;\n"},
		{"object-literal", "export const answer = { v: await Promise.resolve(1) };\n"},
		{"array-literal", "export const answer = [await Promise.resolve(1), await Promise.resolve(2)];\n"},
		{"awaited-then", "export const answer = await Promise.resolve(1).then((v) => v + 1);\n"},
		{"async-function-beside", "async function load(): Promise<number> { return 3; }\nexport const answer = await load();\n"},
	}
}

// foldkit-42: `await` at a module's top level awaits a Promise, as in
// TypeScript, with no VibeLang diagnostic (EK4602, EK1001). The native control
// compiles the identical ESM source.
func FuzzTopLevelAwait(f *testing.F) {
	startShortBudget(f)
	shapes := topLevelAwaitShapes()
	for _, shape := range shapes {
		f.Add(shape.name)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string) {
		TestTopLevelAwaitVIPQuoted(t)
		index := slices.IndexFunc(shapes, func(s topLevelAwaitShape) bool { return s.name == name })
		if index < 0 {
			if name == "" {
				return
			}
			index = int(name[0]) % len(shapes)
		}
		shape := shapes[index]
		for _, native := range []bool{true, false} {
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			files := map[string]string{file: shape.source, "package.json": "{ \"type\": \"module\" }\n"}
			var result *Result
			var err error
			within(t, "check top-level await", func() { result, err = w.Compile(t.Context(), Project{Files: files}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !HasError(result.Diagnostics) {
				continue
			}
			if native {
				t.Fatalf("invalid native top-level await control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), shape.source)
			}
			Gap(t, topLevelAwaitTarget, shape.name, "VIP-26: top-level await of a Promise is ordinary JavaScript, got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), shape.source)
		}
		ExpectPending(t, topLevelAwaitTarget, shape.name)
		ExpectPending(t, topLevelAwaitTarget, specCorpusKey(t))
	})
}
