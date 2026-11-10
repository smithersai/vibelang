package tsc

import (
	"bytes"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"gotest.tools/v3/assert"
)

// vibelang/project fails a module load only on the diagnostics that fail the
// build, so it needs the ones the exit-code filter dropped, by printed code.
func TestReportExitIgnoredNamesEachDroppedCategoryAndCode(t *testing.T) {
	t.Parallel()
	lint := func(code int32, category diagnostics.Category) *ast.Diagnostic {
		return ast.NewExternalDiagnostic(nil, core.NewTextRange(0, 0), "EK", category, code, "lint")
	}
	stringify := lint(3889, diagnostics.CategoryError)
	again := lint(3889, diagnostics.CategoryError)
	catch := lint(38122, diagnostics.CategoryError)
	warning := lint(3897, diagnostics.CategoryWarning)
	typeError := ast.NewExternalDiagnostic(nil, core.NewTextRange(0, 0), "", diagnostics.CategoryError, 2322, "type")
	all := []*ast.Diagnostic{typeError, stringify, catch, again, warning}

	var out bytes.Buffer
	ReportExitIgnored(&out, all, []*ast.Diagnostic{typeError, warning})
	assert.Equal(t, out.String(), "VIBELANG-EXIT-IGNORED: error EK38122\nVIBELANG-EXIT-IGNORED: error EK3889\n")

	out.Reset()
	ReportExitIgnored(&out, all, all)
	assert.Equal(t, out.String(), "")
}
