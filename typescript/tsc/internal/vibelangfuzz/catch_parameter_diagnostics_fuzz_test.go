package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const catchParameterDiagnosticQuote = "Independent errors in native embedded expressions and types keep their native diagnostics."

func TestCatchParameterDiagnosticsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), catchParameterDiagnosticQuote) {
		t.Fatal("VIP-34 independent native diagnostic ownership quote changed")
	}
}

var catchParameterHeads = []struct{ key, pattern string }{
	{"typed", "(value%d: string"},
	{"default", "(value%d = 1"},
	{"generic", "<E>(value%d: E"},
	{"two-typed", "(value%d: string, other: number"},
}

func FuzzCatchParameterDiagnostics(f *testing.F) {
	startShortBudget(f)
	for _, head := range catchParameterHeads {
		for variant := byte(0); variant < 8; variant++ {
			f.Add(head.key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestCatchParameterDiagnosticsQuoted(t)
		selected := 0
		for i, head := range catchParameterHeads {
			if head.key == key {
				selected = i
				break
			}
		}
		head := catchParameterHeads[selected]
		gap := []string{" ", " /* parameters */ ", "\n", "\r\n"}[variant&3]
		body := "{ return 0 }"
		if variant&4 != 0 {
			body = "{}"
		}
		source := "effect function f() { return x catch " + fmt.Sprintf(head.pattern, int(variant>>3)) + gap + body + " }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(file.Diagnostics()) == 0 {
			Gap(t, "FuzzCatchParameterDiagnostics", head.key, "missing native parameter-list errors: %s", source)
		}
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" {
				Gap(t, "FuzzCatchParameterDiagnostics", head.key, "%s: native parameter error became %v", catchParameterDiagnosticQuote, d)
			}
		}
		ExpectPending(t, "FuzzCatchParameterDiagnostics", head.key)
		ExpectPending(t, "FuzzCatchParameterDiagnostics", specCorpusKey(t))
	})
}
