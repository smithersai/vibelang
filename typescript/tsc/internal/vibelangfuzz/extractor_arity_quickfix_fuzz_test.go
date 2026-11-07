package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const extractorArityQuickFixTarget = "FuzzExtractorArityQuickFix"
const extractorArityQuickFixQuote = "with the quick fixes " + "\x60when X:\x60 and, for a singleton list, \x60when X(let e):\x60."

func TestExtractorArityQuickFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), extractorArityQuickFixQuote) {
		t.Fatalf("class-pattern quick-fix rule changed: %s", extractorArityQuickFixQuote)
	}
}

// Keyed matcher and argument mutations check every offered action, comment
// retention and name hygiene against a fresh compilation of the edited source.
func FuzzExtractorArityQuickFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"error-empty", "error-pair", "some-empty", "none-one", "retained-empty"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Add("error-pair", uint8(2))
	f.Add("none-one", uint8(2))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		declaration, matcher, args, subject, want := "error E { id: string }", "E", "", "unknown", 2
		switch key {
		case "error-empty":
		case "error-pair":
			args = "let a, let b"
		case "some-empty":
			declaration, matcher, subject = "", "Option.Some", "Option.Option<number>"
		case "none-one":
			declaration, matcher, args, subject, want = "", "Option.None", "let a", "Option.Option<number>", 1
		case "retained-empty":
			declaration, matcher = "", "Cause.TimeoutError"
		}
		if key == "error-pair" || key == "none-one" {
			count := 2 + int(mode>>1)%3
			if key == "none-one" {
				count--
			}
			parts := make([]string, count)
			for i := range parts {
				parts[i] = fmt.Sprintf("let a%d", i)
			}
			args = strings.Join(parts, ", ")
		}
		comment := fmt.Sprintf("/* capture %d */", mode)
		if mode&2 != 0 {
			comment = fmt.Sprintf("// capture %d\n", mode)
		}
		source := "// café 😀\n" + declaration + "\nexport function f(s: " + subject + ", e: unknown) { return match(s) { when " + matcher + "(" + comment + args + "): 1; default: 0; } }\n"
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		before, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		plans, _, seen := quickfixEditorPlans(t, w, before, files, []int32{703})
		if !seen[703] || len(plans) != want {
			Gap(t, extractorArityQuickFixTarget, key, "%s: got %d editor alternatives, want %d; diagnostic=%v\n%s", extractorArityQuickFixQuote, len(plans), want, seen[703], source)
			return
		}
		for _, plan := range plans {
			if len(plan.edits) != 1 {
				t.Fatalf("edit touches unrelated files: %v", plan.edits)
			}
			after, _, err := toolsApply(source, plan.edits["main.vibe"])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(strings.ReplaceAll(after, "\r\n", "\n"), comment) || !strings.Contains(after, "// café 😀") {
				t.Fatalf("lost comment:\n%s", after)
			}
			if strings.Contains(after, "let e)") {
				t.Fatalf("capture shadows the parameter:\n%s", after)
			}
			fixed, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": after}})
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError || diagnosticKey(d) == "EK0703" {
					Gap(t, extractorArityQuickFixTarget, key, "%s: repair left %s\n%s", extractorArityQuickFixQuote, specDiagnosticText(d), after)
				}
			}
		}
	})
}
