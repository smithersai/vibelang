package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const domConstructorTarget = "FuzzEffectGenDOMConstructors"
const domConstructorFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const domConstructorPreludeQuote = "These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's."
const domConstructorAllowlistQuote = "ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `AbortSignal`) stay allowed"
const domConstructorBanQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."

func TestEffectGenDOMConstructorsQuoted(t *testing.T) { domConstructorsQuoted(t) }

func domConstructorsQuoted(t testing.TB) {
	for chapter, quotes := range map[string][]string{
		"007-tooling.md":  {domConstructorFixQuote},
		"005-services.md": {domConstructorPreludeQuote, domConstructorBanQuote, domConstructorAllowlistQuote},
	} {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(text), quote) {
				t.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// Each native constructor crossed with each generator API must convert
// without becoming an Effect namespace. Banned host constructors retain EK4402;
// URL remains an allowed data utility. This is a static-rule oracle.
func FuzzEffectGenDOMConstructors(f *testing.F) {
	startShortBudget(f)
	domConstructorsQuoted(f)
	names := []string{"Headers", "Request", "Response", "URL", "Blob", "Event"}
	forms := []string{"named", "fn", "untraced", "gen"}
	var keys []string
	for _, name := range names {
		for _, form := range forms {
			key := name + "/" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := strings.TrimPrefix(string(data), "key:")
		if !slices.Contains(keys, key) {
			index := 0
			if len(data) != 0 {
				index = int(data[0]) % len(keys)
			}
			key = keys[index]
		}
		parts := strings.Split(key, "/")
		name, form := parts[0], parts[1]
		arg := map[string]string{"Headers": "input", "Request": "\"https://example.test\"", "Response": "\"body\"", "URL": "\"https://example.test\"", "Blob": "[\"body\"]", "Event": "\"ready\""}[name]
		body := fmt.Sprintf("return new %s(%s)", name, arg)
		generator := "function*(input: Readonly<Record<string, string>>) { " + body + " }"
		call := map[string]string{
			"named":    "Effect.fn(\"make\")(" + generator + ")",
			"fn":       "Effect.fn(" + generator + ")",
			"untraced": "Effect.fnUntraced(" + generator + ")",
			"gen":      "(input: Readonly<Record<string, string>>) => Effect.gen(function*() { " + body + " })",
		}[form]
		source := "import { Effect } from \"effect\"\nexport const make = " + call + "\n"
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, domConstructorTarget, files)
		defer before.Remove()
		fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir))
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		afterFiles := maps.Clone(files)
		for path, file := range fixed.Files {
			afterFiles[strings.TrimPrefix(path.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		text := afterFiles["main.vibe"]
		if strings.Contains(text, "function*") {
			Gap(t, domConstructorTarget, key, "%s: constructor conversion refused: %+v\n%s", domConstructorFixQuote, fixed.Refused, text)
			return
		}
		after := toolsCompile(t, w, domConstructorTarget, afterFiles)
		defer after.Remove()
		banned := name != "URL"
		hasBan := false
		for _, d := range after.Diagnostics {
			if d.Code() == 4402 && d.Source() == "EK" {
				hasBan = true
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, domConstructorTarget, key, "constructor gained an error: %s\n%s", d.String(), text)
				return
			}
		}
		if hasBan != banned {
			Gap(t, domConstructorTarget, key, "%s: EK4402=%t, want %t\n%s", domConstructorBanQuote, hasBan, banned, text)
			return
		}
		ExpectPending(t, domConstructorTarget, key)
	})
}
