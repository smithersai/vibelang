package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const globalLegacyMemberQuote = "A member `eval` or `Function` is the global itself"
const globalLegacyExemptionQuote = "`x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed."
const globalLegacyModuleQuote = "Such code lives in a `.ts` file or a `module` body"

func requireGlobalLegacyMemberQuotes(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{globalLegacyMemberQuote, globalLegacyExemptionQuote, globalLegacyModuleQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 001 no longer says %q", quote)
		}
	}
}
func TestGlobalLegacyMembersQuoted(t *testing.T) { requireGlobalLegacyMemberQuotes(t) }

type globalLegacyCase struct {
	key, source string
	want        int
}

func globalLegacyCases() []globalLegacyCase {
	var out []globalLegacyCase
	for _, member := range []string{"eval", "Function"} {
		for _, access := range []struct{ key, format string }{
			{"dot", "%s." + member}, {"string", "%s[\"" + member + "\"]"}, {"template", "%s[`" + member + "`]"},
			{"optional-dot", "%s?." + member}, {"optional-string", "%s?.[\"" + member + "\"]"},
			{"escaped-string", "%s[\"\\u" + map[string]string{"eval": "0065val", "Function": "0046unction"}[member] + "\"]"},
		} {
			for _, receiver := range []struct{ key, source string }{{"direct", "globalThis"}, {"repeated", "globalThis[\"globalThis\"]"}, {"parenthesized", "(globalThis)"}} {
				expr := fmt.Sprintf(access.format, receiver.source)
				out = append(out, globalLegacyCase{member + "/" + access.key + "/" + receiver.key, "export const value = " + expr, 1})
			}
		}
	}
	for _, c := range []globalLegacyCase{
		{"shadow-function-name", "const Function = () => 0; export const value = globalThis.Function", 1},
		{"prototype", "export const value = globalThis[\"Function\"][`prototype`]", 0},
		{"optional-prototype", "export const value = globalThis.Function?.prototype", 0},
		{"instanceof", "export const value = (() => 1) instanceof (globalThis[\"Function\"])", 0},
		{"type-query", "export type Value = typeof globalThis.Function", 0},
		{"shadow", "const globalThis = {eval: () => 1, Function: () => 2}; export const value = [globalThis.eval,globalThis.Function]", 0},
		{"module", "module Native { export const value = globalThis.eval; export const constructor = globalThis.Function }\nexport {}", 0},
	} {
		out = append(out, c)
	}
	return out
}

// Chapter 001 rejects these runtime global reads, including literal escapes
// and optional/repeated receivers. Their TypeScript twins remain ordinary
// TypeScript; prototype/instanceof, type queries, shadows and module bodies
// preserve their independently specified boundaries.
func FuzzGlobalLegacyMembers(f *testing.F) {
	startShortBudget(f)
	requireGlobalLegacyMemberQuotes(f)
	cases := globalLegacyCases()
	w := NewWorkspace(f)
	for _, c := range cases {
		f.Add(c.key)
	}
	f.Fuzz(func(t *testing.T, key string) {
		selected := -1
		for i, c := range cases {
			if c.key == key {
				selected = i
				break
			}
		}
		if selected < 0 {
			var n uint64
			for _, b := range []byte(key) {
				n = n*33 + uint64(b)
			}
			selected = int(n % uint64(len(cases)))
		}
		c := cases[selected]
		key = c.key
		for _, name := range []string{"main.vibe", "main.ts"} {
			// VIP-40's module body is VibeLang syntax; its native counterpart is a
			// namespace with the same unmodified TypeScript declarations.
			source := c.source
			if name == "main.ts" && c.key == "module" {
				source = strings.Replace(source, "module Native", "namespace Native", 1)
			}
			r, err := w.Compile(context.Background(), Project{Files: map[string]string{name: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			got := 0
			for _, d := range r.Diagnostics {
				if d.Source() == "EK" && d.Code() == 107 {
					got++
				} else if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid generator control %s %s: %s\n%s", key, name, d.String(), source)
				}
			}
			want := c.want
			if name == "main.ts" {
				want = 0
			}
			if got != want {
				Gap(t, "FuzzGlobalLegacyMembers", key+":"+name, "Chapter 001: %s; %s; %s: got %d EK0107, want %d\n%s", globalLegacyMemberQuote, globalLegacyExemptionQuote, globalLegacyModuleQuote, got, want, source)
			}
		}
		ExpectPending(t, "FuzzGlobalLegacyMembers", key)
		ExpectPending(t, "FuzzGlobalLegacyMembers", specCorpusKey(t))
	})
}
