package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const effectUsingWarningQuote = "| `using` in effect code | `EK0801` | Use `acquireDisposable` inside `scoped`. |"

func effectUsingWarningCited(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), effectUsingWarningQuote) {
		t.Fatalf("chapter 7 no longer says %q", effectUsingWarningQuote)
	}
}
func TestEffectUsingWarningQuoted(t *testing.T) { effectUsingWarningCited(t) }

type usingWarningContext struct {
	key, template string
	count         int
}

func usingWarningContexts() []usingWarningContext {
	return []usingWarningContext{
		{"function", "export effect function load() { %s; return 1 }", 1},
		{"arrow", "export const load = effect () => { %s; return 1 }", 1},
		{"block", "export const load = effect { %s; return 1 }", 1},
		{"method", "export class Loader { effect load() { %s; return 1 } }", 1},
		{"producer", "export effect function* load() { %s; yield 1 }", 1},
		{"nested-block", "export effect function load() { { %s; } return 1 }", 1},
		{"for-of", "export effect function load() { for (using r of [resource]) { } return 1 }", 1},
		{"plain", "export function load() { %s; return 1 }", 0},
		{"nested-plain", "export effect function load() { function inner() { %s; return 1 }; return 1 }", 0},
		{"nested-arrow", "export effect function load() { const inner = () => { %s; return 1 }; return 1 }", 0},
		{"async", "export async function load() { %s; return 1 }", 0},
		{"module", "%s; export const loaded = 1", 0},
	}
}

// VIP-34 source advice: changing severity changes only the diagnostic, and
// the innermost source callable decides whether native using is in Effect code.
// Keyed contexts survive reordering; mutation varies trivia, declarator count
// and a null Disposable without changing the number of declaration lists.
func FuzzEffectUsingWarning(f *testing.F) {
	startShortBudget(f)
	effectUsingWarningCited(f)
	contexts := usingWarningContexts()
	severities := []string{"default", "warning", "error", "suggestion", "off"}
	for _, context := range contexts {
		for _, severity := range severities {
			f.Add(context.key+":"+severity, uint8(0))
			f.Add(context.key+":"+severity, uint8(4))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		context, severity := contexts[0], severities[0]
		found := false
		for _, candidate := range contexts {
			for _, level := range severities {
				if key == candidate.key+":"+level {
					context, severity, found = candidate, level, true
				}
			}
		}
		if !found {
			context = contexts[int(mutation)%len(contexts)]
			severity = severities[len(key)%len(severities)]
			key = context.key + ":" + severity
		}
		declaration := []string{
			"using r = resource",
			"using /* resource 😀 */ r = (resource)",
			"using r = resource, second = resource",
			"using r = null",
			"using r = 1",
		}[int(mutation)%5]
		source := "declare const resource: Disposable;\n" + strings.Replace(context.template, "%s", declaration, 1)
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"lib":["ESNext","DOM"],"types":[]},"files":["main.vibe"]`
		if severity != "default" {
			config += fmt.Sprintf(`,"vibe":{"severities":{"EK0801":%q}}`, severity)
		}
		config += "}"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		want := context.count
		category := diagnostics.CategoryWarning
		switch severity {
		case "off":
			want = 0
		case "error":
			category = diagnostics.CategoryError
		case "suggestion":
			category = diagnostics.CategorySuggestion
		}
		invalid := mutation%5 == 4 && context.key != "for-of"
		disposalErrors := 0
		got := 0
		allDiagnostics := result.Diagnostics
		// Suggestions are editor diagnostics, collected separately from CLI
		// semantic diagnostics just as for the existing await advisories.
		if result.Program != nil {
			allDiagnostics = append(allDiagnostics, result.Program.GetSuggestionDiagnostics(t.Context(), result.SourceFile("main.vibe"))...)
		}
		for _, d := range allDiagnostics {
			if IsEK(d) && d.Code() == 801 {
				got++
				if d.Category() != category {
					t.Fatalf("%s: wrong category: %s", key, d.String())
				}
				start := d.Pos()
				if start < 0 || start+5 > len(source) || source[start:start+5] != "using" {
					t.Fatalf("%s: warning must point at using: %s", key, d.String())
				}
			} else if d.Category() == diagnostics.CategoryError && d.Code() == 2850 && invalid {
				disposalErrors++
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s: unexpected error: %s\n%s", key, d.String(), source)
			}
		}
		wantDisposalErrors := 0
		if invalid {
			wantDisposalErrors = 1
		}
		if disposalErrors != wantDisposalErrors {
			t.Fatalf("%s: native disposal errors = %d, want %d; severity must not alter TS2850", key, disposalErrors, wantDisposalErrors)
		}
		if got != want {
			Gap(t, "FuzzEffectUsingWarning", key, "VIP-34/chapter 7: %s; got %d warnings, want %d\n%s", effectUsingWarningQuote, got, want, source)
		}
	})
}
