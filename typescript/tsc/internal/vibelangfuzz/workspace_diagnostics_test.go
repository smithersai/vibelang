package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const diagnosticOccurrencesQuote = "diagnostic codes, categories and occurrences"

func workspaceDiagnosticOccurrencesQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), diagnosticOccurrencesQuote) {
		t.Fatalf("chapter 7 no longer says %q", diagnosticOccurrencesQuote)
	}
}
func TestWorkspaceDiagnosticOccurrencesQuoted(t *testing.T) { workspaceDiagnosticOccurrencesQuoted(t) }

func TestWorkspaceDiagnosticOccurrences(t *testing.T) {
	w := NewWorkspace(t)
	for _, stop := range []bool{false, true} {
		r, err := w.Compile(t.Context(), Project{
			Config: fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","declaration":true,"emitDeclarationOnly":true,"noEmitOnError":%t,"types":[]},"files":["first.ts","second.ts"]}`, stop),
			Files:  map[string]string{"first.ts": "export const a: number = 'bad'\nexport const b: number = 'bad'\n", "second.ts": "export const c: number = 'bad'\n"},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var positions []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if d.Code() != 2322 {
				t.Fatalf("unexpected diagnostic: %s", d.String())
			}
			positions = append(positions, fmt.Sprintf("%s:%d", d.File().FileName(), d.Pos()))
		}
		if len(positions) != 3 {
			t.Fatalf("noEmitOnError=%v: want three distinct source errors, got %v", stop, positions)
		}
		seen := map[string]bool{}
		for _, p := range positions {
			if seen[p] {
				t.Fatalf("duplicated occurrence %s", p)
			}
			seen[p] = true
		}
	}
}

// The native source contains one independently ill-typed declaration at each
// generated position. Checking and emit must not multiply those occurrences.
func FuzzWorkspaceDiagnosticOccurrences(f *testing.F) {
	startShortBudget(f)
	workspaceDiagnosticOccurrencesQuoted(f)
	for _, seed := range []byte{0, 1, 2, 3, 7, 15, 31} {
		f.Add([]byte{seed})
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		variant := byte(0)
		if len(data) > 0 {
			variant = data[0]
		}
		count := 1 + int(variant>>4)%3
		files := map[string]string{}
		var names []string
		extension := ".ts"
		if variant&4 != 0 {
			extension = ".vibe"
		}
		for i := 0; i < count; i++ {
			name := fmt.Sprintf("source%d%s", i, extension)
			files[name] = fmt.Sprintf("export const value%d: number = 'bad'\n", i)
			names = append(names, fmt.Sprintf("%q", name))
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","declaration":true,"emitDeclarationOnly":%t,"noEmit":%t,"noEmitOnError":%t,"types":[]},"files":[%s]}`, variant&8 == 0, variant&8 != 0, variant&1 != 0, strings.Join(names, ","))
		r, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := 0
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				if d.Code() != 2322 {
					t.Fatalf("unexpected diagnostic: %s", d.String())
				}
				errors++
			}
		}
		if errors != count {
			Gap(t, "FuzzWorkspaceDiagnosticOccurrences", "native-occurrences", "chapter 7: %s; %d source errors became %d diagnostics (variant=%d)", diagnosticOccurrencesQuote, count, errors, variant)
			return
		}
		// Formatting recompiles the same project and must retain the same
		// distinct source occurrences even when emit repeats pre-emit errors.
		after := toolsRecompile(t, w, r, files)
		if len(after.Diagnostics) != len(r.Diagnostics) {
			t.Fatalf("recompile changed diagnostic occurrences: %d -> %d", len(r.Diagnostics), len(after.Diagnostics))
		}
		ExpectPending(t, "FuzzWorkspaceDiagnosticOccurrences", "native-occurrences")
		ExpectPending(t, "FuzzWorkspaceDiagnosticOccurrences", specCorpusKey(t))
	})
}
