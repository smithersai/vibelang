package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var grammarDeclarationDecoratorQuotes = []string{
	"ErrorStart       = \"error\"   [no LineTerminator here] BindingIdentifier",
	"SchemaErrorStart = \"schema\"  [no LineTerminator here] \"error\" [no LineTerminator here] BindingIdentifier",
	"ServiceStart     = \"service\" [no LineTerminator here] BindingIdentifier",
}

func TestGrammarAdmissionDeclarationDecoratorsQuoted(t *testing.T) {
	for _, quote := range grammarDeclarationDecoratorQuotes {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("Appendix A declaration start changed: %s", quote)
		}
	}
}

// The source-syntax record bounds the declaration's own modifier prefix.
// This excludes decorators on native classes, on members and in a containing
// declaration. Strings and comments inside the prefix are not decorator tokens.
func grammarDeclarationDecorators(source string) (found bool) {
	if !strings.Contains(source, "@") {
		return false
	}
	// This classifier must not turn a separate parser recovery panic into a
	// declaration-decorator finding. The compiler oracle still sees that panic.
	defer func() {
		if recover() != nil {
			found = false
		}
	}()
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{
		FileName: "/fuzz/main.vibe", PathKey: "/fuzz/main.vibe",
	}, source)
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxDeclaration ||
			form.Name != "error" && form.Name != "schema error" && form.Name != "service" {
			continue
		}
		start, end := form.Range.Pos(), form.Head.Pos()
		if start < 0 || end > len(source) || start >= end {
			continue
		}
		for _, tok := range grammarLexSource(source[start:end]) {
			if tok.text == "@" {
				return true
			}
		}
	}
	return false
}

var grammarDeclarationDecoratorGaps = []string{
	"@dec error E { }",
	"@dec export error E { }",
	"export @dec error E { }",
	"@dec schema error E { }",
	"@dec service S { value: number }",
	"@dec service S: { value: number } { }",
	"@a @b error E { }",
	"@dec(1) error E { }",
	"@ns.dec error E { }",
	"@(x => x) error E { }",
	"@dec\nerror E { }",
	"function f() { @dec error E { } }",
}

func TestGrammarAdmissionDeclarationDecoratorsKeys(t *testing.T) {
	for _, source := range grammarDeclarationDecoratorGaps {
		if got := grammarAdmissionForm(source); got != "admission:declaration-decorators" {
			t.Errorf("key=%q, want admission:declaration-decorators: %q", got, source)
		}
	}
	for _, source := range []string{
		"@dec class C { }",
		"@dec export class C { }",
		"class C { @dec m() { } }",
		"class C { @dec effect m() { } }",
		"error E { @dec m() { } }",
		"schema error E { @dec m() { } }",
		"@dec class C { m() { error E { } } }",
		"@dec class C { } error E { }",
		"const text = '@dec error E { }';",
		"// @dec\nerror E { }",
		"/* @dec */ error E { }",
	} {
		if grammarDeclarationDecorators(source) {
			t.Errorf("an unrelated decorator was keyed: %q", source)
		}
	}
}

func TestGrammarAdmissionDeclarationDecoratorsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarDeclarationDecoratorGaps {
		t.Run(source, func(t *testing.T) {
			// The unchanged oracle and pending corpus detect XPASS when the
			// compiler rejects this form; the regression then graduates by
			// removing its pending entries.
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
