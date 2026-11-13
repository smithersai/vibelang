package vibelang

import (
	"slices"
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestDiagnosticHelpersIncludeSyntaxErrors(t *testing.T) {
	for _, source := range []string{
		"export const value = ;",
		"const f = effect function fork() { return 1 }",
		"const f = effect function* join() { yield 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			syntax := p.GetSyntacticDiagnostics(t.Context(), file)
			if len(syntax) == 0 {
				t.Fatal("fixture must have a syntax error")
			}
			errors := errorsOf(t, source)
			codes := errorCodesOf(t, source)
			for _, d := range syntax {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				found := false
				for _, got := range errors {
					if got.Code() == d.Code() && got.Source() == d.Source() {
						found = true
					}
				}
				if !found {
					t.Errorf("errorsOf omitted syntax diagnostic %s", d.String())
				}
				code := d.Source() + strconv.Itoa(int(d.Code()))
				if !slices.Contains(codes, code) {
					t.Errorf("errorCodesOf omitted syntax diagnostic %s; got %v", code, codes)
				}
			}
		})
	}
}

// The helpers must preserve both diagnostic phases even when recovery changes
// the semantic errors. Arbitrary suffixes explore malformed fixture neighbours.
func FuzzDiagnosticHelpers(f *testing.F) {
	// Independent fixtures have different temporary directories. Compare the
	// diagnostics' identities so quoted module paths cannot cause false failures.
	type identity struct {
		source   string
		code     int32
		category diagnostics.Category
		pos, end int
	}
	key := func(d *ast.Diagnostic) identity {
		return identity{d.Source(), d.Code(), d.Category(), d.Pos(), d.End()}
	}
	for _, seed := range []string{"", "const value = ;", "const f = effect function fork() { return 1 }", "for concurrent (", "import * as self from './main.vibe'; const x: number = self;"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, suffix string) {
		if len(suffix) > 128 {
			t.Skip()
		}
		source := "export const value = 1;\n" + suffix
		p, file, _, _ := editorProgram(t, source)
		var wantErrors []identity
		var wantCodes []string
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				wantErrors = append(wantErrors, key(d))
			}
			if d.Category() == diagnostics.CategoryError || d.Category() == diagnostics.CategoryWarning {
				wantCodes = append(wantCodes, d.Source()+strconv.Itoa(int(d.Code())))
			}
		}
		var gotErrors []identity
		for _, d := range errorsOf(t, source) {
			gotErrors = append(gotErrors, key(d))
		}
		if !slices.Equal(gotErrors, wantErrors) {
			t.Fatalf("errorsOf = %v, want %v", gotErrors, wantErrors)
		}
		if got := errorCodesOf(t, source); !slices.Equal(got, wantCodes) {
			t.Fatalf("errorCodesOf = %v, want %v", got, wantCodes)
		}
	})
}
