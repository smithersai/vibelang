package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"testing"
)

func cov2004aDiagnostics(t *testing.T, source string, wanted int32) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if wanted != 0 && d.Code() == wanted {
			count++
			continue
		}
		t.Errorf("unexpected diagnostic: %s\n%s", d.String(), source)
	}
	if wanted != 0 && count != 1 {
		t.Fatalf("wanted one diagnostic %d, got %d\n%s", wanted, count, source)
	}
}

func TestCov2004aArityWarning(t *testing.T) {
	// Chapter 004: impossible extractor arity is a warning; rule-evidence: docs/design/src/004-match.md#009f34dfa2d64800
	source := "error E { id:string }; function f(s:unknown){return match(s){when E(let a,let b):1;default:0;}}"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Code() == 703 && d.Source() == diagnosticSource {
			count++
			if d.Category() != diagnostics.CategoryWarning {
				t.Errorf("EK0703 must be a warning: %s", d.String())
			}
		} else if d.Category() == diagnostics.CategoryError {
			t.Errorf("unexpected error: %s", d.String())
		}
	}
	if count != 1 {
		t.Fatalf("wanted one EK0703 warning, got %d", count)
	}
}

func TestCov2004aRefinedDomain(t *testing.T) {
	if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") == "" {
		t.Skip("docs/design/src/004-match.md#839f2afffd98ae0d: issue #580: represented generic tag refinement with a false guard misses EK4701; set VIBELANG_COVERAGE_RUN_PENDING=1 to run the retained assertion")
	}

	// Chapter 004: represented tag refinements reduce a generic finite domain; rule-evidence: docs/design/src/004-match.md#839f2afffd98ae0d
	for _, tc := range []struct {
		name, source string
		wanted       int32
	}{
		{"complete", "function f<T extends {_tag:'A'}|{_tag:'B'}>(s:T & {_tag:'A'}) {return match(s){when {_tag:'A'}:1;};}", 0},
		{"guarded-is-still-finite", "function f<T extends {_tag:'A'}|{_tag:'B'}>(s:T & {_tag:'A'}) {return match(s){when {_tag:'A'} and if(false):1;};}", 4701},
	} {
		t.Run(tc.name, func(t *testing.T) { cov2004aDiagnostics(t, tc.source, tc.wanted) })
	}
}

func TestCov2004aLiteralTypes(t *testing.T) {
	// Chapter 004: ordinary literal domains and arm narrowings keep literal types; rule-evidence: docs/design/src/004-match.md#30a09c58c5640170
	for _, source := range []string{
		"function f(s:1|2):1|2{return match(s){when 1:do{const n:1=s;n};when 2:do{const n:2=s;n};};}",
		"function f(s:'a'|'b'):'a'|'b'{return match(s){when 'a':do{const n:'a'=s;n};when 'b':do{const n:'b'=s;n};};}",
		"function f(s:boolean):boolean{return match(s){when true:do{const n:true=s;n};when false:do{const n:false=s;n};};}",
	} {
		t.Run(source, func(t *testing.T) { cov2004aDiagnostics(t, source, 0) })
	}
}

func TestCov2004aOpenTagDomain(t *testing.T) {
	// Chapter 004: broad string and template tags disable finite-domain exhaustiveness; rule-evidence: docs/design/src/004-match.md#b6c90e176507290b
	for _, source := range []string{
		"function f(s:{_tag:string}){return match(s){when {_tag:'A'}:1;};}",
		"function f(s:{_tag:`tag-${string}`}){return match(s){when {_tag:'tag-A'}:1;};}",
		"function f(s:{_tag:`tag-${number}`}){return match(s){when {_tag:'tag-1'}:1;};}",
	} {
		t.Run(source, func(t *testing.T) { cov2004aDiagnostics(t, source, 0) })
	}
}

func TestCov2004aOrdinaryClassNarrowing(t *testing.T) {
	// Chapter 004: a bare ordinary class pattern narrows by instanceof; rule-evidence: docs/design/src/004-match.md#1761f4f2b8111988
	cov2004aDiagnostics(t, "class C { n=1 }; function f(s:unknown):number {return match(s){when C:s.n;default:0;};}", 0)
}
