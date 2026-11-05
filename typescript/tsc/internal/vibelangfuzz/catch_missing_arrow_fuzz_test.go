package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const catchMissingArrowQuote = "For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression."

const catchMissingArrowRepairQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestCatchMissingArrowQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), catchMissingArrowQuote) {
		t.Fatal("VIP-5 missing-arrow recovery quote changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), catchMissingArrowRepairQuote) {
		t.Fatal("preserving repair rule changed")
	}
}

// Keyed heads and fuzzed trivia, grouping and try prefixes exercise the
// recovery boundary. The repaired literal is a separate positive control.
func FuzzCatchMissingArrow(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), catchMissingArrowQuote) {
		f.Fatal("VIP-5 missing-arrow recovery quote changed")
	}
	heads := []string{"plain", "effect", "typed", "generic", "empty", "async"}
	for _, key := range heads {
		for _, mutation := range []uint8{0, 1, 2, 3, 8, 10, 11} {
			f.Add(key, mutation)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		head := "(e)"
		switch key {
		case "effect":
			head = "effect (e)"
		case "typed":
			head = "(e: string)"
		case "generic":
			head = "<E extends string>(e: E)"
		case "empty":
			head = "()"
		case "async":
			head = "async (e)"
		default:
			key = "plain"
		}
		trivia := []string{" ", " /* arrow */ ", "\n", "\r\n"}[mutation%4]
		prefix := ""
		if mutation&4 != 0 {
			prefix = "try "
		}
		grouping := mutation&8 != 0
		check := func(arrow string, want int32) {
			handler := head + trivia + arrow + "{ return 0 }"
			if arrow != "" {
				// Native arrows forbid a line break before =>. Keep the mutated
				// trivia after the arrow when constructing the admitted control.
				handler = head + " " + arrow + trivia + "{ return 0 }"
			}
			if grouping {
				handler = "(" + handler + ")"
			}
			source := "import { Effect } from \"effect\"; export effect function f() { return " + prefix + "Effect.fail(\"bad\") catch " + handler + " }"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []string
			found := false
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
					if IsEK(d) && d.Code() == want {
						found = true
					}
				}
			}
			if want == 0 && len(codes) != 0 || want != 0 && (!found || len(codes) != 1) {
				Gap(t, "FuzzCatchMissingArrow", key, "%s: want only EK%04d (zero means no errors), got %v\n%s", catchMissingArrowQuote, want, codes, source)
			}

			// Unmodified parameter heads use the documented implicit-effect repair.
			// Modified heads retain their separate diagnostic-only controls.
			if want == 509 && key != "async" && key != "effect" && prefix == "" {
				// Keep the explicit-import diagnostic control above. Use implicit
				// Effect globals for this repair so independent import cleanup
				// cannot change the bytes this arrow-preservation oracle checks.
				repairSource := strings.TrimPrefix(source, "import { Effect } from \"effect\"; ")
				repair, err := w.Compile(t.Context(), Single(repairSource))
				if err != nil {
					t.Fatal(err)
				}
				defer repair.Remove()
				fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, repair.Dir), vibelang.FixOptions{})
				if fixed.Err != nil || len(fixed.Refused) != 0 || len(fixed.Files) != 1 {
					Gap(t, "FuzzCatchMissingArrow", fmt.Sprintf("fix:%s:%d", key, mutation), "missing preserving repair: %+v", fixed)
					return
				}
				repaired := "effect " + head + " =>" + trivia + "{ return 0 }"
				if grouping {
					repaired = "(" + repaired + ")"
				}
				expected := strings.Replace(repairSource, handler, repaired, 1)
				for _, file := range fixed.Files {
					if file.Text != expected {
						Gap(t, "FuzzCatchMissingArrow", fmt.Sprintf("fix:%s:%d", key, mutation), "%s: repair must preserve parameter and body trivia\ngot:\n%s\nwant:\n%s", catchMissingArrowRepairQuote, file.Text, expected)
					}
					after, err := w.Compile(t.Context(), Single(file.Text))
					if err != nil {
						t.Fatal(err)
					}
					defer after.Remove()
					if !toolsErrorFree(after) {
						Gap(t, "FuzzCatchMissingArrow", fmt.Sprintf("fix-errors:%s:%d", key, mutation), "repaired handler has errors: %v", after.Diagnostics)
					}
				}
			}
		}
		check("", 509)
		// Async is independently forbidden and try+catch is a separate rule.
		if key != "async" && prefix == "" {
			check("=> ", 0)
		}
	})
}
