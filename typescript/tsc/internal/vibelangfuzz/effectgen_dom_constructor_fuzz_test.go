package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const domConstructorTarget = "FuzzEffectGenDOMConstructors"
const domConstructorFixQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."
const domConstructorPreludeQuote = "These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's."
const domConstructorAllowlistQuote = "ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `AbortSignal`) stay allowed"
const domConstructorBanQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."

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
