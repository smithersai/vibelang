package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const entryMainQuote = "There is no magic entry point. A function named `main` is an ordinary function, and you run it with a runner yourself, exactly as in Effect TypeScript."

func TestEntryMainQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), entryMainQuote) {
		t.Fatalf("chapter 1 no longer says %q", entryMainQuote)
	}
}

var entryMainForms = []struct{ key, declaration, tail string }{
	{"const-arrow", "export const main = () => 7", ""},
	{"let-arrow", "export let main = () => 7", ""},
	{"const-expression", "export const main = function () { return 7 }", ""},
	{"const-named-expression", "export const main = function main() { return 7 }", ""},
	{"let-expression", "export let main = function () { return 7 }", ""},
	{"let-named-expression", "export let main = function main() { return 7 }", ""},
	{"self-binding", "export const main = function main(): unknown { return main }", ""},
	{"writable-let", "export let main = () => 7", "\nmain = () => 9"},
	{"annotated", "export const main: () => number = () => 7", ""},
	{"async-arrow", "export const main = async () => 7", ""},
	{"effect-arrow", "export const main = effect () => 7", ""},
	{"parameters", "export const main = (n = 7) => n", ""},
}

// This is a static migration oracle: VIP-26 grants main no special
// declaration form. --fix must retain its lexical declaration, including
// when a deferred read before initialization makes the distinction observable.
// Runtime TDZ equivalence is also exercised by entry-const-main-tdz.
func FuzzEntryMainFix(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), entryMainQuote) {
		f.Fatal("stale entry quote")
	}
	for _, form := range entryMainForms {
		f.Add(form.key, false)
		f.Add(form.key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string, late bool) {
		if input == "" {
			return
		}
		form := entryMainForms[int(input[0])%len(entryMainForms)]
		for _, candidate := range entryMainForms {
			if candidate.key == input {
				form = candidate
				break
			}
		}
		read := "\nexport const seen = typeof read()\n"
		source := "function read(): unknown { return main }\n"
		if !late {
			source += read
		}
		source += form.declaration + form.tail + "\n"
		if late {
			source += read
		}
		r := toolsCompile(t, w, "FuzzEntryMainFix", map[string]string{"main.vibe": source})
		defer r.Remove()
		if HasError(r.Diagnostics) {
			t.Fatalf("invalid entry control: %v\n%s", Keys(r.Dir, r.Diagnostics), source)
		}
		key := "lexical-main:" + form.key
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 4843 {
				Gap(t, "FuzzEntryMainFix", key, "%s; retired entry warning: %s", entryMainQuote, d.String())
			}
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		for name, file := range fixed.Files {
			if strings.HasSuffix(string(name), "/main.vibe") {
				lexical := "export const main"
				if strings.Contains(form.declaration, "export let") {
					lexical = "export let main"
				}
				if !strings.Contains(file.Text, lexical) || strings.Contains(file.Text, "export function main") {
					Gap(t, "FuzzEntryMainFix", key, "%s; --fix changes a lexical declaration:\n%s\ninto:\n%s", entryMainQuote, source, file.Text)
				}
			}
		}
		ExpectPending(t, "FuzzEntryMainFix", key)
	})
}
