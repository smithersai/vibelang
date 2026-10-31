package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const provideParenQuote = "Parentheses make anything else a Layer expression: `provide (a, b) { }` provides the comma expression's value."

var provideParenKeys = []string{"comma", "nested", "assignment", "outer-list", "multiline", "no-space", "bare-list", "ordinary-call", "arrow-call", "nested-block"}

func provideParenQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), provideParenQuote) {
		t.Fatalf("chapter 5 no longer says %q", provideParenQuote)
	}
}
func TestProvideParenthesizedExpressionsQuoted(t *testing.T) { provideParenQuoted(t) }

func TestProvideParenthesizedExpressions(t *testing.T) {
	provideParenQuoted(t)
	w := NewWorkspace(t)
	for _, key := range []string{"comma", "nested", "assignment", "arrow-call", "nested-block"} {
		t.Run(key, func(t *testing.T) { checkProvideParen(t, w, key, 0) })
	}
}

// Native expression parentheses determine the one provider's value. Vary
// nesting, discarded side effects, assignments, comments and internal line
// breaks; bare lists and ordinary calls retain their own interpretation.
func FuzzProvideParenthesizedExpressions(f *testing.F) {
	startShortBudget(f)
	provideParenQuoted(f)
	for _, key := range provideParenKeys {
		for variant := byte(0); variant < 4; variant++ {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		if !slices.Contains(provideParenKeys, key) {
			key = "comma"
		}
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		checkProvideParen(t, w, key, variant)
	})
}

func checkProvideParen(t *testing.T, w *Workspace, key string, variant byte) {
	t.Helper()
	count := 1 + int(variant)%3
	var parts []string
	for i := 0; i < count; i++ {
		parts = append(parts, fmt.Sprintf("seen.push(%d)", i))
	}
	parts = append(parts, "Layer.empty")
	separator := ", "
	if key == "multiline" {
		separator = ",\n"
	} else if variant&2 != 0 {
		separator = ", /* expression */ "
	}
	expression := strings.Join(parts, separator)
	if key == "assignment" {
		expression = "chosen = Layer.empty"
	}
	if key == "arrow-call" {
		expression = "((next = Layer.empty): Layer.Layer<never> => next)()"
	}
	if key == "nested-block" {
		expression = "withProvider { return Layer.empty }"
	}
	depth := 1
	if key == "nested" {
		depth = 2 + int(variant)%3
	}
	head := strings.Repeat("(", depth) + expression + strings.Repeat(")", depth)
	gap := " "
	if key == "no-space" {
		gap = ""
	}
	if key == "outer-list" {
		head += ", Layer.empty"
	}
	if key == "bare-list" {
		head = expression
	}
	source := fmt.Sprintf("export effect function main() {\n const seen: number[] = []\n let chosen = Layer.empty\n provide%s%s { return seen.length }\n}\n", gap, head)
	files := map[string]string{"main.vibe": source}
	if key == "nested-block" {
		files["main.vibe"] = "function withProvider(program: () => Layer.Layer<never>): Layer.Layer<never> { return Layer.empty }\n" + source
	}
	if key == "ordinary-call" {
		files["main.vibe"] = "function provide(value: number): number { return value }\nexport effect function main() { provide(1)\n{ return 1 } }\n"
	}
	result, err := w.Compile(t.Context(), Project{
		Config: `{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
		Files:  files,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	got := 0
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if key != "bare-list" || d.Source() != "EK" || d.Code() != 3207 {
			Gap(t, "FuzzProvideParenthesizedExpressions", key, "chapter 5: %s; unexpected diagnostic %s in %q", provideParenQuote, fmt.Sprintf("%s%d[%d:%d]: %s", d.Source(), d.Code(), d.Pos(), d.End(), d.String()), files["main.vibe"])
			return
		}
		got++
	}
	want := 0
	if key == "bare-list" {
		want = 1
	}
	if got != want {
		Gap(t, "FuzzProvideParenthesizedExpressions", key, "want %d EK3207, got %d", want, got)
		return
	}
	ExpectPending(t, "FuzzProvideParenthesizedExpressions", key)
	ExpectPending(t, "FuzzProvideParenthesizedExpressions", specCorpusKey(t))
}
