package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const servicePatternAdviceBindingQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const servicePatternAdviceMisuseQuote = "a class pattern `when Users:` or `when Users(…):`"

func servicePatternAdviceBindingQuoted(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{"007-tooling.md": servicePatternAdviceBindingQuote, "005-services.md": servicePatternAdviceMisuseQuote} {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func TestServicePatternAdviceBindingQuoted(t *testing.T) { servicePatternAdviceBindingQuoted(t) }

// A diagnostic repair must parse and type-check in the original function
// context. Property names need not be legal bindings in that context.
func FuzzServicePatternAdviceBinding(f *testing.F) {
	startShortBudget(f)
	servicePatternAdviceBindingQuoted(f)
	keys := []string{"default", "class", "return", "import", "yield", "await", "eval", "arguments", "fork", "join", "region"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		variant := byte(len(data))
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		modifier := []string{"", "effect ", "async "}[int(variant)%3]
		shape, body := "", key+": number"
		if variant&4 != 0 {
			shape, body = ": { "+key+": number }", ""
		}
		prefix := fmt.Sprintf("export service S%s { static readonly key = \"advice/S\"; %s }\nexport %sfunction read(input: unknown) { return ", shape, body, modifier)
		source := prefix + "match (input) { when S: 1; default: 0; } }"
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]},"files":["main.vibe"]}`
		compile := func(source string) *Result {
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			return r
		}
		r := compile(source)
		advice, count := "", 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 3004 {
				count++
				text := layerMergeAdviceText(d)
				if start := strings.Index(text, "when { "); start >= 0 {
					advice = strings.TrimSuffix(text[start:], ".")
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("fixture %s: %s", key, d.String())
			}
		}
		if count != 1 || advice == "" {
			Gap(t, "FuzzServicePatternAdviceBinding", key, "%s; want one EK3004 with member advice, got %d, %q", servicePatternAdviceMisuseQuote, count, advice)
			return
		}
		repaired := compile(prefix + "match (input) { " + advice + ": 1; default: 0; } }")
		for _, d := range repaired.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzServicePatternAdviceBinding", key, "%s; suggested pattern %q rejected: %s", servicePatternAdviceBindingQuote, advice, d.String())
				return
			}
		}
		ExpectPending(t, "FuzzServicePatternAdviceBinding", key)
		ExpectPending(t, "FuzzServicePatternAdviceBinding", specCorpusKey(t))
	})
}
