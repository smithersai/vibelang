package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

var importMetaErasedRules = []struct {
	key, source string
	allowed     bool
}{
	{"direct-url", "export const result=import.meta.url;", true},
	{"direct-alias", "export const result=import.meta;export const invalid:number=\"wrong\";", false},
	{"direct-computed", "export const result=import.meta[\"url\"];export const invalid:number=\"wrong\";", false},
	{"direct-env", "export const result=import.meta.env;export const invalid:number=\"wrong\";", false},
	{"direct-resolve", "export const result=import.meta.resolve;export const invalid:number=\"wrong\";", false},
	{"parenthesized-url", "export const result=(import.meta).url;", true},
	{"parenthesized-alias", "export const result=(import.meta);export const invalid:number=\"wrong\";", false},
	{"parenthesized-computed", "export const result=(import.meta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"parenthesized-env", "export const result=(import.meta).env;export const invalid:number=\"wrong\";", false},
	{"parenthesized-resolve", "export const result=(import.meta).resolve;export const invalid:number=\"wrong\";", false},
	{"asserted-url", "export const result=(import.meta as ImportMeta).url;", true},
	{"asserted-alias", "export const result=(import.meta as ImportMeta);export const invalid:number=\"wrong\";", false},
	{"asserted-computed", "export const result=(import.meta as ImportMeta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"asserted-env", "export const result=(import.meta as ImportMeta).env;export const invalid:number=\"wrong\";", false},
	{"asserted-resolve", "export const result=(import.meta as ImportMeta).resolve;export const invalid:number=\"wrong\";", false},
	{"any-url", "export const result=(import.meta as any).url;", true},
	{"any-alias", "export const result=(import.meta as any);export const invalid:number=\"wrong\";", false},
	{"any-computed", "export const result=(import.meta as any)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"any-env", "export const result=(import.meta as any).env;export const invalid:number=\"wrong\";", false},
	{"any-resolve", "export const result=(import.meta as any).resolve;export const invalid:number=\"wrong\";", false},
	{"satisfies-url", "export const result=(import.meta satisfies ImportMeta).url;", true},
	{"satisfies-alias", "export const result=(import.meta satisfies ImportMeta);export const invalid:number=\"wrong\";", false},
	{"satisfies-computed", "export const result=(import.meta satisfies ImportMeta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"satisfies-env", "export const result=(import.meta satisfies ImportMeta).env;export const invalid:number=\"wrong\";", false},
	{"satisfies-resolve", "export const result=(import.meta satisfies ImportMeta).resolve;export const invalid:number=\"wrong\";", false},
	{"nonnull-url", "export const result=import.meta!.url;", true},
	{"nonnull-alias", "export const result=import.meta!;export const invalid:number=\"wrong\";", false},
	{"nonnull-computed", "export const result=import.meta![\"url\"];export const invalid:number=\"wrong\";", false},
	{"nonnull-env", "export const result=import.meta!.env;export const invalid:number=\"wrong\";", false},
	{"nonnull-resolve", "export const result=import.meta!.resolve;export const invalid:number=\"wrong\";", false},
	{"angle-url", "export const result=(<ImportMeta>import.meta).url;", true},
	{"angle-alias", "export const result=(<ImportMeta>import.meta);export const invalid:number=\"wrong\";", false},
	{"angle-computed", "export const result=(<ImportMeta>import.meta)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"angle-env", "export const result=(<ImportMeta>import.meta).env;export const invalid:number=\"wrong\";", false},
	{"angle-resolve", "export const result=(<ImportMeta>import.meta).resolve;export const invalid:number=\"wrong\";", false},
	{"nested-url", "export const result=(((import.meta as unknown) as ImportMeta)!).url;", true},
	{"nested-alias", "export const result=(((import.meta as unknown) as ImportMeta)!);export const invalid:number=\"wrong\";", false},
	{"nested-computed", "export const result=(((import.meta as unknown) as ImportMeta)!)[\"url\"];export const invalid:number=\"wrong\";", false},
	{"nested-env", "export const result=(((import.meta as unknown) as ImportMeta)!).env;export const invalid:number=\"wrong\";", false},
	{"nested-resolve", "export const result=(((import.meta as unknown) as ImportMeta)!).resolve;export const invalid:number=\"wrong\";", false},
}

const importMetaErasedQuote = "Members are checked against the program's `ImportMeta` declarations."

func importMetaErasedChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(servicesRulesChapter(t), importMetaErasedQuote) {
		t.Fatalf("chapter 5 no longer says %q", importMetaErasedQuote)
	}
}
func TestImportMetaErasedQuoted(t *testing.T) { importMetaErasedChapter(t) }
func FuzzImportMetaErasedWrappers(f *testing.F) {
	startShortBudget(f)
	importMetaErasedChapter(f)
	for _, r := range importMetaErasedRules {
		f.Add([]byte(r.key))
		f.Add([]byte(r.key + "\x00\x03"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := 0
		if len(data) > 0 {
			i = int(data[0]) % len(importMetaErasedRules)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for j, r := range importMetaErasedRules {
			if parts[0] == r.key {
				i = j
				break
			}
		}
		r := importMetaErasedRules[i]
		source := r.source
		var variant byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = "// retained trivia\r\n" + source
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "result", "observed")
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		codes := map[int32]int{}
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes[d.Code()]++
			}
		}
		ok := len(codes) == 0
		if !r.allowed {
			ok = codes[2322] == 1 && codes[4402] == 0
			// Undeclared members keep TypeScript's ordinary error through erased wrappers.
			missing := strings.HasSuffix(r.key, "-env") && !strings.HasPrefix(r.key, "any-")
			if missing {
				ok = ok && len(codes) == 2 && codes[2339] == 1
			} else {
				ok = ok && len(codes) == 1
			}
		}
		if !ok {
			Gap(t, "FuzzImportMetaErasedWrappers", r.key, "chapter 5: %s; well-typed control=%t, got %v", importMetaErasedQuote, r.allowed, codes)
			return
		}
		ExpectPending(t, "FuzzImportMetaErasedWrappers", r.key)
		ExpectPending(t, "FuzzImportMetaErasedWrappers", specCorpusKey(t))
	})
}
