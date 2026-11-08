package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatAdjacentTarget = "FuzzFormatAdjacentDeclarations"
const formatAdjacentQuote = "formatting preserves parsed program meaning"
const formatAdjacentAliasQuote = "each declaration keeping its own JSDoc and export status."

func TestFormatAdjacentDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", formatAdjacentQuote)
	chapterSays(t, "006-data.md", formatAdjacentAliasQuote)
}

func FuzzFormatAdjacentDeclarations(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "007-tooling.md", formatAdjacentQuote)
	chapterSays(f, "006-data.md", formatAdjacentAliasQuote)
	keys := []string{"schema", "error", "schema-error", "data", "written-companion"}
	for _, key := range keys {
		for mode := uint8(0); mode < 3; mode++ {
			f.Add(key, mode, mode, false)
		}
	}
	f.Add("written-companion", uint8(0), uint8(0), true)
	formatter := toolsFormatter(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, tail, trivia uint8, nested bool) {
		TestFormatAdjacentDeclarationsQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		selected := int(key[0]) % len(keys)
		for i, k := range keys {
			if key == k {
				selected = i
			}
		}
		heads := []string{"schema Message { id: string }", "error Message { id: string }", "schema error Message { id: string }", "data Message { Value { id: string } }", "schema Message { id: string }"}
		tails := []string{"export type Alias = string", "export const marker = 1", "export function next(){return 1}", "export class Next {}", "export schema Next { value: number }"}
		ending := tails[tail%uint8(len(tails))]
		if selected == 4 {
			ending = "export type Message = typeof Message.Type"
		}
		separator := []string{" ", "; ", " /* between */ ", "\n", " /*\n*/ ", "\r\n", "\u2028", "\u2029"}[trivia%8]
		source := "/** First docs. */ export " + heads[selected] + separator + "/** Next docs. */ " + ending + "\n"
		if nested {
			source = "export function outer(){" + strings.ReplaceAll(source, "export ", "") + "return 0}\n"
		}
		caseKey := fmt.Sprintf("%s/%d/%d/%t", keys[selected], tail%uint8(len(tails)), trivia%8, nested)
		once, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			Gap(t, formatAdjacentTarget, caseKey, formatAdjacentQuote+": %v\\n%s", err, source)
			return
		}
		twice, err := vibelangfmt.Format("main.vibe", once, formatter)
		if err != nil || twice != once {
			Gap(t, formatAdjacentTarget, caseKey, "format is not idempotent: %v\\n%s\\n%s", err, once, twice)
			return
		}
		for _, comment := range []string{"/** First docs. */", "/** Next docs. */"} {
			if strings.Count(once, comment) != 1 {
				t.Fatalf("lost documentation %q: %s", comment, once)
			}
		}
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		after, err := w.Compile(t.Context(), Single(once))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		for _, r := range []*Result{before, after} {
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid formatted witness: %s\\n%s", specDiagnosticText(d), source)
				}
			}
		}
		if difference := toolsFormatDifference(before, after); difference != "" {
			Gap(t, formatAdjacentTarget, caseKey, formatAdjacentQuote+": %s\\n%s", difference, source)
		}
		a, b := before.Outputs["out/main.d.ts"], after.Outputs["out/main.d.ts"]
		if a == "" || a != b {
			Gap(t, formatAdjacentTarget, caseKey, formatAdjacentAliasQuote+" declarations differ\\n%s\\n%s", a, b)
		}
	})
}
