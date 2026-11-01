package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const reviewColdConsoleTarget = "FuzzReviewColdConsole"
const reviewPlatformShadowQuote = "A local binding, an import or an Effect module in scope shadows the global first."
const reviewConsoleQuote = "`console` or a timer"
const reviewGlobalBanQuote = "A reference in any `.vibe` code"
const reviewEffectBlockQuote = "Inside it, `try` runs Effects, as in an `effect` function (VIP-5)."

func TestReviewColdConsoleQuoted(t *testing.T) {
	for file, quotes := range map[string][]string{
		"../vips/0033-platform-stdlib.md":      {reviewPlatformShadowQuote, reviewConsoleQuote, reviewGlobalBanQuote},
		"../vips/0002-effect-blocks-and-do.md": {reviewEffectBlockQuote},
	} {
		text, err := os.ReadFile(SpecPath(file))
		if err != nil {
			t.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(text), quote) {
				t.Fatalf("%s no longer says %q", file, quote)
			}
		}
	}
}

func reviewColdConsoleSource(home, form string, shadow bool, native bool) string {
	statement := map[string]string{
		"call":        "console.log(\"hi\");",
		"optional":    "console?.log(\"hi\");",
		"member":      "console[\"log\"](\"hi\");",
		"alias":       "const logger = console; void logger;",
		"destructure": "const {log: write} = console; void write;",
		"repair":      "try log(\"hi\");",
	}[form]
	prefix := ""
	if shadow && form != "repair" {
		prefix = "const console = {log(_text: string): void {}};\n"
	}
	if native && form == "repair" {
		statement = "void Effect.log(\"hi\");"
	}
	body := prefix + statement + "\nreturn 1;\n"
	source := ""
	switch home {
	case "function":
		source = "function create() {\n" + body + "}\n"
	case "effect-function":
		source = "effect function create() {\n" + body + "}\n"
	default:
		source = "const p = effect {\n" + body + "};\nvoid p;\n"
	}
	// Plain functions construct the logging repair as a cold Effect.
	if home == "function" && form == "repair" {
		source = "function create() { return effect {\n" + body + "} }\n"
	}
	if native {
		source = strings.ReplaceAll(source, "effect function", "function")
		source = strings.ReplaceAll(source, "effect {", "(() => {")
		if home == "block" {
			source = strings.Replace(source, "};\nvoid p;", "})();\nvoid p;", 1)
		}
		if home == "function" && form == "repair" {
			source = strings.Replace(source, "} }\n", "})(); }\n", 1)
		}
		source = "import {Effect} from \"effect\";\n" + source
	}
	return "export {};\n" + source
}

// R5 ASTRA3: the host ban covers cold blocks and either kind of function.
// TypeScript counterparts prove static validity only. Local shadowing and
// Effect.log are positive controls, not runtime comparisons.
func FuzzReviewColdConsole(f *testing.F) {
	startShortBudget(f)
	homes := []string{"block", "function", "effect-function"}
	forms := []string{"call", "optional", "member", "alias", "destructure", "repair"}
	for _, home := range homes {
		for _, form := range forms {
			f.Add(home, form, false)
			if form != "repair" {
				f.Add(home, form, true)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, home, form string, shadow bool) {
		TestReviewColdConsoleQuoted(t)
		if !slices.Contains(homes, home) {
			home = homes[len(home)%len(homes)]
		}
		if !slices.Contains(forms, form) {
			form = forms[len(form)%len(forms)]
		}
		if form == "repair" {
			shadow = false
		}
		key := fmt.Sprintf("%s:%s:shadow=%t", home, form, shadow)
		reject := !shadow && form != "repair"
		for _, native := range []bool{true, false} {
			file := "main.vibe"
			if native {
				file = "control.ts"
			}
			source := reviewColdConsoleSource(home, form, shadow, native)
			var result *Result
			var err error
			within(t, "check cold-block platform references", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			expectedBan, other := 0, 0
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if IsEK(d) && d.Code() == 4402 {
					expectedBan++
				} else {
					other++
				}
			}
			valid := expectedBan == 0 && other == 0
			if !native && reject {
				valid = expectedBan > 0 && other == 0
			}
			if !valid {
				if native {
					t.Fatalf("invalid native control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				Gap(t, reviewColdConsoleTarget, key, "VIP33 any Vibe context; reject=%t; diagnostics=%v\n%s", reject, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, reviewColdConsoleTarget, key)
		ExpectPending(t, reviewColdConsoleTarget, specCorpusKey(t))
	})
}
