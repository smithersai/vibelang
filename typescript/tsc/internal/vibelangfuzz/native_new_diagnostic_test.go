package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

const nativeNewQuote = "`new f()` on a `.vibe` function gets TypeScript's own error only, with no VibeLang check (VIP-1, amended)."

func TestNativeNewDiagnosticQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), nativeNewQuote) {
		t.Fatalf("stale VIP-1 quote: %s", nativeNewQuote)
	}
}

var nativeNewForms = []struct{ key, vibe, ts, target string }{
	{"effect-declaration", "effect function f() { return 1 }", "function f() { return Effect.succeed(1) }", "f"},
	{"effect-expression", "const f = effect function () { return 1 }", "const f = function () { return Effect.succeed(1) }", "f"},
	{"effect-arrow", "const f = effect () => 1", "const f = () => Effect.succeed(1)", "f"},
	{"plain-declaration", "function f() { return 1 }", "function f() { return 1 }", "f"},
	{"plain-expression", "const f = function () { return 1 }", "const f = function () { return 1 }", "f"},
	{"plain-arrow", "const f = () => 1", "const f = () => 1", "f"},
	{"async-declaration", "async function f() { return 1 }", "async function f() { return 1 }", "f"},
	{"void-declaration", "function f(): void {}", "function f(): void {}", "f"},
	{"effect-method", "const o = {effect f() { return 1 }}", "const o = {f() { return Effect.succeed(1) }}", "o.f"},
	{"class", "class f {}", "class f {}", "f"},
}

func FuzzNativeNewDiagnostic(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), nativeNewQuote) {
		f.Fatal("stale native-new quote")
	}
	keys := []string{}
	for _, form := range nativeNewForms {
		for _, mode := range []string{"strict", "loose", "cast", "ignore", "parenthesized", "argument"} {
			key := form.key + ":" + mode
			keys = append(keys, key)
			f.Add(key)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if !slices.Contains(keys, key) {
			index := 0
			for _, b := range []byte(key) {
				index = (index + int(b)) % len(keys)
			}
			key = keys[index]
		}
		parts := strings.Split(key, ":")
		form := nativeNewForms[slices.IndexFunc(nativeNewForms, func(e struct{ key, vibe, ts, target string }) bool { return e.key == parts[0] })]
		target, prefix, args := form.target, "", ""
		config := DefaultConfig
		switch parts[1] {
		case "loose":
			config = strings.Replace(config, "\"strict\": true", "\"strict\": false", 1)
		case "cast":
			target = "(" + target + " as any)"
		case "ignore":
			prefix = "// @ts-ignore\n"
		case "parenthesized":
			target = "((" + target + "))"
		case "argument":
			args = "missingArgument"
		}
		call := "\n" + prefix + "new " + target + "(" + args + ");\nexport {}\n"
		all := [][]string{}
		g := &Gaps{Target: "FuzzNativeNewDiagnostic", Input: key + "\n" + form.vibe + call}
		for _, file := range []string{"main.vibe", "main.ts"} {
			body := form.vibe
			if file == "main.ts" {
				body = form.ts
			}
			c, err := w.Compile(t.Context(), Project{Files: map[string]string{
				file:           "import * as Effect from \"effect/Effect\";\n" + body + call,
				"package.json": servicesPackage,
			}, Config: strings.TrimSuffix(config, "\n}") + fmt.Sprintf(",\n\"files\":[%q]\n}", file)})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			if c.Program == nil {
				t.Fatal("missing constructor program")
			}
			codes := []string{}
			for _, d := range c.Diagnostics {
				if IsEK(d) {
					g.Add("native-new:"+key, "%s got %v; %s", file, Keys(c.Dir, c.Diagnostics), nativeNewQuote)
				}
				codes = append(codes, fmt.Sprintf("%s:%d:%v", d.Source(), d.Code(), d.Category()))
			}
			slices.Sort(codes)
			all = append(all, codes)
		}
		if !slices.Equal(all[0], all[1]) {
			g.Add("native-new:"+key, "Vibe diagnostics %v != TypeScript counterpart %v; %s", all[0], all[1], nativeNewQuote)
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
