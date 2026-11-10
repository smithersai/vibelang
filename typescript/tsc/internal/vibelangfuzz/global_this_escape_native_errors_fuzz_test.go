package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const globalThisNativeQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."
const globalThisEscapeQuote = "`globalThis` may appear only as the object of a statically named member access"

func globalThisNativeChapters(t testing.TB) {
	t.Helper()
	for _, rule := range []struct{ chapter, quote string }{
		{"007-tooling.md", globalThisNativeQuote},
		{"005-services.md", globalThisEscapeQuote},
	} {
		b, err := os.ReadFile(SpecPath(rule.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), rule.quote) {
			t.Fatalf("chapter %s no longer says %q", rule.chapter, rule.quote)
		}
	}
}
func TestGlobalThisEscapeNativeErrorsQuoted(t *testing.T) { globalThisNativeChapters(t) }

func FuzzGlobalThisEscapeNativeErrors(f *testing.F) {
	startShortBudget(f)
	globalThisNativeChapters(f)
	rules := []struct {
		key, source string
		native      int32
		escapes     int
	}{
		{"missing-key", "export const value = globalThis[Missing];", 2304, 1},
		{"arity", "export const value = globalThis[((n:number)=>n)()];", 2554, 1},
		{"callability", "export const value = globalThis[(1)()];", 2349, 1},
		{"argument-type", "export const value = globalThis[((n:number)=>n)(\"bad\")];", 2345, 1},
		{"assertion-type", "export const value = (globalThis as Missing);", 2304, 1},
		{"satisfies", "export const value = (globalThis satisfies number);", 1360, 1},
		{"key-type", "export const value = globalThis[(1 as Missing)];", 2304, 1},
		{"nested-index", "declare const key:string; declare const empty:{}; export const value = globalThis[empty[key]];", 7053, 1},
		{"undefined-index", "declare const key:string; export const value = globalThis[({})[key]];", 2538, 1},
		{"ordinary-key", "declare const key:string; export const value = globalThis[key];", 0, 1},
		{"numeric-key", "export const value = globalThis[0];", 0, 1},
		{"alias", "export const value = globalThis;", 0, 1},
		{"static-property", "export const value = globalThis.Missing;", 7017, 0},
		{"static-allowed", "export const value = globalThis[\"Object\"];", 0, 0},
	}
	keys := []string{}
	for _, row := range rules {
		keys = append(keys, row.key)
		f.Add([]byte(row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.Index(keys, parts[0])
		if i < 0 {
			i = len(data) % len(rules)
		}
		row := rules[i]
		variant := byte(len(data))
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		source := row.source
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "globalThis", "globalThis.globalThis")
		}
		if variant&2 != 0 {
			source = "// retained trivia\r\n" + source
		}
		if variant&4 != 0 {
			source = strings.ReplaceAll(source, "value", "observed")
		}
		r, err := w.Compile(t.Context(), Project{
			Config: `{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
			Files:  map[string]string{"main.vibe": source, "package.json": servicesPackage},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[int32]int{}
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
			}
		}
		want := 0
		if row.escapes != 0 {
			want++
		}
		if row.native != 0 {
			want++
		}
		if len(got) != want || got[107] != row.escapes || row.native != 0 && got[row.native] != 1 {
			Gap(t, "FuzzGlobalThisEscapeNativeErrors", row.key, "%s; %s; want %d EK0107 and independent TS%d, got %v", globalThisEscapeQuote, globalThisNativeQuote, row.escapes, row.native, got)
			return
		}
		ExpectPending(t, "FuzzGlobalThisEscapeNativeErrors", row.key)
		ExpectPending(t, "FuzzGlobalThisEscapeNativeErrors", specCorpusKey(t))
	})
}
