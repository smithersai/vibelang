package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var suffixes = []string{"Fz", "Q1", "_x", "Zz9", "Dup"}

func categoryName(c diagnostics.Category) string {
	switch c {
	case diagnostics.CategoryError:
		return CategoryError
	case diagnostics.CategoryWarning:
		return CategoryWarning
	}
	return strings.ToLower(c.Name())
}

func diagnosticKey(d *ast.Diagnostic) string {
	if d.Source() == "EK" {
		return fmt.Sprintf("EK%04d", d.Code())
	}
	return fmt.Sprintf("TS%d", d.Code())
}

func describe(d *ast.Diagnostic) string {
	where := "(global)"
	if d.File() != nil {
		where = fmt.Sprintf("%s@%d-%d", filepath.Base(string(d.File().FileName())), d.Pos(), d.End())
	}
	return fmt.Sprintf("%s %s %s: %s", categoryName(d.Category()), diagnosticKey(d), where, d.String())
}

func inFile(d *ast.Diagnostic, name string) bool {
	return d.File() != nil && strings.HasSuffix(filepath.ToSlash(string(d.File().FileName())), "/"+name)
}
