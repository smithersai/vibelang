package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const tryPromiseDOMTarget = "FuzzEffectTryPromiseDOMConstructors"

const tryPromiseNoCodemodQuote = "VibeLang ships no codemod of its own before its first release"

const tryPromiseDOMPreludeQuote = "These namespaces come in scope with the precedence above, so a subpath namespace whose name is a web platform global names Effect's."
const tryPromiseDOMBanQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."
const tryPromiseDOMAllowlistQuote = "ECMAScript library globals (`Date.now`, `Math.random`, `JSON`, `Intl`) and web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`, `AbortSignal`) stay allowed"

func tryPromiseDOMQuoted(t testing.TB) {
	chapterSays(t, "../vips/0034-compiler-and-tooling.md", tryPromiseNoCodemodQuote)
	for _, quote := range []string{tryPromiseDOMPreludeQuote, tryPromiseDOMBanQuote, tryPromiseDOMAllowlistQuote} {
		chapterSays(t, "005-services.md", quote)
	}
}

func TestEffectTryPromiseDOMConstructorsQuoted(t *testing.T) { tryPromiseDOMQuoted(t) }

// VIP-34 retires the previous CLI-codemod requirement. These same source and corpus
// keys now check the active binding contract: unqualified colliding names
// denote Effect namespaces; explicit host constructors retain the platform ban.
// No CLI codemod is requested or required. URL remains an allowed data utility.
func FuzzEffectTryPromiseDOMConstructors(f *testing.F) {
	startShortBudget(f)
	tryPromiseDOMQuoted(f)
	var keys []string
	for _, name := range []string{"Headers", "Response", "URL"} {
		for _, form := range []string{"expression", "block", "conditional", "named-import", "global"} {
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
		parameter := "input: string"
		if name == "Headers" {
			parameter = "input: Readonly<Record<string, string>>"
		}
		constructor := "new " + name + "(input)"
		if form == "global" {
			constructor = "new globalThis." + name + "(input)"
		}
		thunk := "() => Promise.resolve(" + constructor + ")"
		if form == "block" {
			thunk = "() => { const value = " + constructor + "; return Promise.resolve(value) }"
		}
		call := "Effect.tryPromise(" + thunk + ")"
		if form == "conditional" {
			call = "input ? " + call + " : Effect.succeed(undefined)"
		}
		imports := "import * as Effect from \"effect/Effect\"\n"
		if form == "named-import" {
			imports = "import { Effect } from \"effect\"\n"
		}
		source := imports + "export const make = (" + parameter + ") => " + call + "\n"
		twin := toolsCompile(t, w, tryPromiseDOMTarget, map[string]string{"main.ts": source})
		defer twin.Remove()
		if HasError(twin.Diagnostics) {
			t.Fatalf("invalid TypeScript constructor twin: %v\n%s", SortedKeys(Keys(twin.Dir, twin.Diagnostics)), source)
		}
		native := toolsCompile(t, w, tryPromiseDOMTarget, map[string]string{"main.vibe": source})
		defer native.Remove()
		hasBan, hasNamespaceError := false, false
		for _, d := range native.Diagnostics {
			if d.Code() == 4402 && d.Source() == "EK" {
				hasBan = true
				continue
			}
			if d.Code() == 2351 && d.Source() != "EK" {
				hasNamespaceError = true
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, tryPromiseDOMTarget, key, "%s: constructor gained an unrelated error: %s\n%s", tryPromiseDOMPreludeQuote, d.String(), source)
				return
			}
		}
		banned := name != "URL" && form == "global"
		namespace := name != "URL" && form != "global"
		if hasBan != banned || hasNamespaceError != namespace {
			Gap(t, tryPromiseDOMTarget, key, "%s; %s: EK4402=%t, namespace constructor error=%t, constructor=%s\n%s",
				tryPromiseDOMPreludeQuote, tryPromiseDOMBanQuote, hasBan, hasNamespaceError, name, source)
			return
		}
		ExpectPending(t, tryPromiseDOMTarget, key)
	})
}
