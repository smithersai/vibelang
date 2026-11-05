package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLegacyDirectiveCategoryQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", legacySeverityQuote)
	chapterSays(t, "900-appendices.md", defaultCategoryQuote)
}

func FuzzLegacyDirectiveCategories(f *testing.F) {
	startShortBudget(f)
	keys := []string{"file", "next", "expired", "after", "sibling", "string", "block", "named", "wildcard", "near-miss", "trailing"}
	for _, key := range keys {
		for mode := uint8(0); mode < 24; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestLegacyDirectiveCategoryQuoted(t)
		configSeverity := []string{"", "error", "warning", "off"}[mode%4]
		selected := []string{"error", "warning", "off"}[(mode/4)%3]
		pragma := "// @vibelang-diagnostics EK4818:" + selected
		base := "export async function value() { return JSON.parse(\"{}\") as number }\n"
		source, other := base, "export {}\n"
		want := configSeverity
		if want == "" {
			want = "off"
		}
		switch key {
		case "file":
			source = pragma + "\n" + base
			want = selected
		case "next":
			source = strings.Replace(pragma, "diagnostics ", "diagnostics-next-line ", 1) + "\n" + base
			want = selected
		case "expired":
			source = strings.Replace(pragma, "diagnostics ", "diagnostics-next-line ", 1) + "\nvoid 0\n" + base
		case "after":
			source = base + pragma + "\n"
		case "sibling":
			other = pragma + "\n" + other
		case "string":
			source = "const note=" + fmt.Sprintf("%q", pragma) + "\n" + base
		case "block":
			source = strings.Replace(pragma, "// ", "/* ", 1) + " */\n" + base
			want = selected
		case "named":
			source = strings.Replace(pragma, " EK4818:", " *:off EK4818:", 1) + "\n" + base
			want = selected
		case "wildcard":
			source = strings.Replace(pragma, "EK4818:", "*:", 1) + "\n" + base
			want = selected
		case "near-miss":
			source = strings.Replace(pragma, "EK4818:", "EK48180:", 1) + "\n" + base
		case "trailing":
			source = "void 0; " + pragma + "\n" + base
		}
		source = "// café 😀\n" + source
		if mode >= 12 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
			other = strings.ReplaceAll(other, "\n", "\r\n")
		}
		settings := map[string]string{}
		config := map[string]any{"compilerOptions": map[string]any{"target": "es2022", "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": true}, "files": []string{"main.vibe", "other.vibe"}}
		if configSeverity != "" {
			settings["EK4818"] = configSeverity
			config["vibelang"] = map[string]any{"diagnostics": settings}
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "other.vibe": other}, Config: string(encoded)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		var witness *ast.Diagnostic
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 4818 {
				count++
				witness = d
				expected := map[string]diagnostics.Category{"error": diagnostics.CategoryError, "warning": diagnostics.CategoryWarning}[want]
				if want == "off" || d.Category() != expected {
					t.Fatalf("case %s mode %d want=%s got=%s source=%s", key, mode, want, d.Category().Name(), source)
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
		}
		expectedCount := 0
		if want != "off" {
			expectedCount = 1
		}
		if count != expectedCount {
			t.Fatalf("case %s mode %d want %d EK4818, got %d: %v", key, mode, expectedCount, count, r.Diagnostics)
		}
		defaults := !strings.Contains(source, "@vibelang-diagnostics") && !strings.Contains(other, "@vibelang-diagnostics")
		g := &Gaps{Target: "FuzzLegacyDirectiveCategories", Input: key}
		CheckDiagnostics(g, r.Dir, r.Diagnostics, defaults, settings)
		if g.Any() {
			t.Fatalf("valid configured categories rejected: %+v", g.found)
		}
		if witness != nil {
			for _, category := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion} {
				if category == witness.Category() {
					continue
				}
				fake := ast.NewDiagnosticFromText(witness.File(), witness.Loc(), 4818, category, witness.MessageText(), nil, nil, false, false).SetExternalData(witness.Source(), witness.MessageText())
				bad := &Gaps{Target: "FuzzLegacyDirectiveCategories", Input: key}
				CheckDiagnostics(bad, r.Dir, []*ast.Diagnostic{fake}, defaults, settings)
				if !bad.Any() {
					t.Fatalf("wrong category %s escaped the oracle for %s", category.Name(), key)
				}
			}
		}
	})
}
