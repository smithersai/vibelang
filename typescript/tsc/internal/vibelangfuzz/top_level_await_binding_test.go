package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// awaitBindingRules are the spellings FuzzTopLevelAwaitBindings puts at each
// position. A binding names a parameter await, which a module never allows
// (await is reserved in ES module code, and a .vibe file's top level is ES
// top-level await: TS1359); an expression is an await of a Promise, which
// the top level allows. The first landing of foldkit-42 parsed the top level
// in await context and lost TS1359 for `(await: number) => 1`
// (TestBugBashAwaitBinding, main 0d0c6b46ee6e).
var awaitBindingRules = []struct {
	key, text string
	binding   bool
}{
	{"arrow-typed", "(await: number) => 1", true},
	{"arrow-comma", "(await, b: number) => b", true},
	{"arrow-optional", "(await?: number) => 1", true},
	{"arrow-default", "(await = 1) => 1", true},
	{"arrow-second", "(a: number, await: number) => a", true},
	{"arrow-object", "({ x: await }: { x: number }) => 1", true},
	{"arrow-array", "([await]: number[]) => 1", true},
	{"arrow-rest", "(...await: number[]) => 1", true},
	{"arrow-generic", "<T>(await: T) => 1", true},
	{"function-expression", "function (await: number) { return 1 }", true},
	{"paren-await", "(await Promise.resolve(1))", false},
	{"paren-await-sum", "(await Promise.resolve(1)) + 1", false},
	{"paren-await-paren", "(await (Promise.resolve(1)))", false},
	{"paren-await-comma", "(await Promise.resolve(1), 2)", false},
}

// awaitBindingPositions are the places a rule's text goes. Top-level ones
// reach the module's top level without a function boundary; the others are
// inside a function, where an await expression is VibeLang's, so only
// bindings go there.
var awaitBindingPositions = []struct {
	key, template string
	topLevel      bool
}{
	{"declaration", "export const f = {X}\n", true},
	{"argument", "const sink: unknown[] = []\nsink.push({X})\n", true},
	{"block", "const sink: unknown[] = []\nif (Math.random() >= 0) { const f = {X}; sink.push(f) }\n", true},
	{"function", "export function g() { const f = {X}; return f }\n", false},
	{"arrow-body", "export const g = () => {X}\n", false},
}

// FuzzTopLevelAwaitBindings checks every rule at every position it applies
// to: a binding reports TS1359 wherever it is, and a top-level await of a
// Promise compiles to ES await with no error and no $await. Keyed input
// `<rule>:<position>`; other bytes pick by index.
func FuzzTopLevelAwaitBindings(f *testing.F) {
	startShortBudget(f)
	for _, q := range topLevelAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.quote) {
			f.Fatalf("chapter %s no longer says %q; update the quote", q.chapter, q.quote)
		}
	}
	for _, r := range awaitBindingRules {
		for _, p := range awaitBindingPositions {
			if r.binding || p.topLevel {
				f.Add([]byte(r.key + ":" + p.key))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input []byte) {
		ruleKey, positionKey, _ := strings.Cut(string(input), ":")
		rule, position := -1, -1
		for i, r := range awaitBindingRules {
			if r.key == ruleKey {
				rule = i
			}
		}
		for i, p := range awaitBindingPositions {
			if p.key == positionKey {
				position = i
			}
		}
		if rule < 0 || position < 0 {
			if len(input) == 0 {
				return
			}
			rule = int(input[0]) % len(awaitBindingRules)
			position = int(input[len(input)-1]) % len(awaitBindingPositions)
		}
		r, p := awaitBindingRules[rule], awaitBindingPositions[position]
		if !r.binding && !p.topLevel {
			return
		}
		source := strings.ReplaceAll(p.template, "{X}", r.text)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var texts []string
		reserved := false
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			texts = append(texts, specDiagnosticText(d))
			if d.Code() == 1359 {
				reserved = true
			}
		}
		js := result.Outputs["out/main.js"]
		key := r.key + ":" + p.key
		if r.binding {
			if !reserved {
				Gap(t, "FuzzTopLevelAwaitBindings", key, "a parameter named await is TS1359 in a module\n%s\nerrors: %v", source, texts)
			}
			return
		}
		if len(texts) != 0 || !strings.Contains(js, "await ") || !strings.Contains(js, "Promise.resolve(1)") || strings.Contains(js, "$await") {
			Gap(t, "FuzzTopLevelAwaitBindings", key, "a parenthesized await of a Promise at the top level is ES top-level await, with no error\n%s\nerrors: %v\n%s", source, texts, js)
		}
	})
}
