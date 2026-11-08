package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3: a callable declared outside VibeLang carries its thrown type
// by one rule whatever file declares it, so a method a .vibe module reads
// from a value it got from a foreign module throws what its declaration
// says, whether a .ts source or a .d.ts declares it. A project compile reads
// a referenced project's declaration output and a module loader's compile
// reads its sources; the two must report the same calls. This compares the
// compiler with itself on the two declaration files the spec says agree,
// and with the rule's own answer: EK0403 exactly for the untagged method.
const foreignReceiverQuote = "A callable declared outside VibeLang, in a `.ts`, `.js` or `.d.ts` file, an npm package or a `module` body (VIP-40), carries a thrown type by one rule"

func TestForeignReceiverContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), foreignReceiverQuote) {
		t.Fatalf("Chapter 3 no longer says %q", foreignReceiverQuote)
	}
}

type foreignReceiverRule struct{ key, body string }

var foreignReceiverRules = []foreignReceiverRule{
	{"const-try-name", "const n = try ns; return n.METHOD(\"x\")"},
	{"const-try-member", "const n = try holder.ns; return n.METHOD(\"x\")"},
	{"const-try-parenthesized", "const n = try (ns); return n.METHOD(\"x\")"},
	{"let-try-name", "let n = try ns; return n.METHOD(\"x\")"},
	{"const-try-alias", "const n = try ns; const m = n; return m.METHOD(\"x\")"},
	{"direct", "return obj.METHOD(\"x\")"},
	{"const-alias", "const n = obj; return n.METHOD(\"x\")"},
	{"const-succeed", "const n = try Effect.succeed(obj); return n.METHOD(\"x\")"},
}

const foreignReceiverSource = `import * as Effect from "effect/Effect"
export interface NS {
  getByName: (name: string) => string
  /** @throws {never} */
  safe(name: string): string
}
const make = (): NS => ({ getByName: (name) => name, safe: (name) => name })
export const ns: Effect.Effect<NS> = Effect.sync(make)
export const holder: { readonly ns: Effect.Effect<NS> } = { ns }
export const obj: NS = make()
`

const foreignReceiverDeclaration = `import type * as Effect from "effect/Effect";
export interface NS {
    getByName: (name: string) => string;
    /** @throws {never} */
    safe(name: string): string;
}
export declare const ns: Effect.Effect<NS>;
export declare const holder: {
    readonly ns: Effect.Effect<NS>;
};
export declare const obj: NS;
`

func FuzzForeignReceiverContract(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("003-failures.md"), foreignReceiverQuote) {
		f.Fatal("foreign callable rule changed")
	}
	for _, rule := range foreignReceiverRules {
		f.Add(rule.key, uint8(0))
		f.Add(rule.key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, tag uint8) {
		const target = "FuzzForeignReceiverContract"
		i := slices.IndexFunc(foreignReceiverRules, func(r foreignReceiverRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(foreignReceiverRules)
		}
		rule := foreignReceiverRules[i]
		method, want := "getByName", true
		if tag%2 == 1 {
			method, want = "safe", false
		}
		source := "import * as Effect from \"effect/Effect\"\nimport { holder, ns, obj } from \"./lib.js\"\nexport const use = effect { " + strings.ReplaceAll(rule.body, "METHOD", method) + " }\n"
		toolsGuard(t, target, func() { checkForeignReceiver(t, w, target, rule, method, source, want) })
	})
}

func checkForeignReceiver(t *testing.T, w *Workspace, target string, rule foreignReceiverRule, method, source string, want bool) {
	reported := map[string]bool{}
	for _, lib := range []struct{ name, text string }{{"lib.ts", foreignReceiverSource}, {"lib.d.ts", foreignReceiverDeclaration}} {
		result := toolsCompile(t, w, target, map[string]string{"main.vibe": source, lib.name: lib.text})
		found := false
		var errors []string
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			errors = append(errors, diagnosticCodeName(d.Source(), d.Code()))
			if d.Source() == "EK" && d.Code() == 403 && strings.HasSuffix(string(d.File().FileName()), "main.vibe") {
				found = true
			}
		}
		result.Remove()
		reported[lib.name] = found
		if found != want {
			Gap(t, target, "receiver:"+rule.key+":"+strings.TrimPrefix(lib.name, "lib.")+":"+method, "Chapter 3: %q; EK0403=%v, want %v; errors %v\n%s", foreignReceiverQuote, found, want, errors, source)
		}
	}
	if reported["lib.ts"] != reported["lib.d.ts"] {
		Gap(t, target, "agree:"+rule.key+":"+method, "Chapter 3: %q; .ts reports %v, .d.ts reports %v\n%s", foreignReceiverQuote, reported["lib.ts"], reported["lib.d.ts"], source)
	}
}
