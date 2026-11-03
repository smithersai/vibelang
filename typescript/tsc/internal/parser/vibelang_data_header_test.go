package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-16, chapter 006: a recognized data header missing its variant body is EK1604.
// Appendix A DataStart needs only data [no LineTerminator here] BindingIdentifier.
func TestDataHeaderRequiredBody(t *testing.T) {
	for _, name := range []string{"D", "as", "satisfies", "is", "type", "$D", "D\\u0061ta"} {
		for _, gap := range []string{" ", " /* name */ ", " /* line\nbreak */ "} {
			for _, ending := range []string{"", ";", "\nconst after = 1;"} {
				source := "data" + gap + name + ending
				t.Run(fmt.Sprintf("%q", source), func(t *testing.T) {
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
					found := 0
					for _, d := range file.Diagnostics() {
						if d.Source() == "EK" && d.Code() == 1604 {
							found++
						}
					}
					want := 1
					if gap == " /* line\nbreak */ " {
						want = 0
					}
					if found != want {
						t.Fatalf("want %d EK1604, got %d: %v", want, found, file.Diagnostics())
					}
				})
			}
		}
	}
	for _, op := range []string{"as", "satisfies", "is"} {
		source := "const data=1; type T=number; data " + op + " T;\nexport {}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		found := false
		for _, d := range file.Diagnostics() {
			found = found || d.Source() == "EK" && d.Code() == 1604
		}
		if !found {
			t.Errorf("%q: missing EK1604: %v", source, file.Diagnostics())
		}
	}
}

func TestDataHeaderExpressionControls(t *testing.T) {
	for _, source := range []string{
		"const data=1; type T=number; (data as T); (data satisfies T); (data is Number);",
		"const data=1; type T=number; function f(){return data as T}",
		"const data=1; type T=number; const x=data satisfies T;",
		"data as { V }; data satisfies { V };",
		"data D\n{ V }; data E<T>\n{ V { value:T } };",
		"data E\n<T> { V { value:T } };",
		"const data=1; type T=number; data\nas: {}",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Errorf("%q rejected: %v", source, ds)
		}
	}
}

func TestDataHeaderAmbientDiagnosticPrecedence(t *testing.T) {
	for _, source := range []string{"declare data D;", "declare namespace N { data D; }", "declare module 'm' { data D; }"} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == 1604 {
				t.Errorf("ambient header must defer to EK1607: %q", source)
			}
		}
	}
}
