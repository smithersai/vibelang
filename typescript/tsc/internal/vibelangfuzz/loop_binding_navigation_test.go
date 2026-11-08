package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const loopBindingNavigationTarget = "FuzzLoopBindingNavigation"
const loopBindingNavigationQuote = "The loop head shadows outer names and does not leak outside the loop."
const loopBindingNavigationNativeQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func TestLoopBindingNavigationQuoted(t *testing.T) {
	for _, row := range []struct{ chapter, quote string }{
		{"004-match.md", loopBindingNavigationQuote},
		{"000-intro.md", loopBindingNavigationNativeQuote},
	} {
		text, err := os.ReadFile(SpecPath(row.chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), row.quote) {
			t.Fatalf("%s no longer says %q", row.chapter, row.quote)
		}
	}
}

// The source name denotes its loop-head binding even when initialization is
// skipped. Token navigation must reach that declaration, as native lexical
// bindings do; it must not return an enclosing lowered expression instead.
func FuzzLoopBindingNavigation(f *testing.F) {
	startShortBudget(f)
	keys := []string{"while", "do", "for-empty", "for-let", "for-const", "for-expression", "for-init", "for-update"}
	for _, key := range keys {
		f.Add(key, uint8(0), false, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, shape uint8, constant bool, flow uint8) {
		TestLoopBindingNavigationQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		selected := keys[int(key[0])%len(keys)]
		for _, candidate := range keys {
			if candidate == key {
				selected = candidate
			}
		}
		word := "let"
		if constant {
			word = "const"
		}
		value, pattern := "1", word+" boundValue"
		switch shape % 3 {
		case 1:
			value, pattern = "{field:1}", "{field:"+word+" boundValue}"
		case 2:
			value, pattern = "[1]", "["+word+" boundValue]"
		}
		test := "(" + value + " is " + pattern + ")"
		condition := "true||" + test
		switch flow % 4 {
		case 1:
			condition = "false&&" + test
		case 2:
			condition = "false?" + test + ":true"
		case 3:
			condition = "Boolean(" + test + ")"
		}
		body := ""
		switch selected {
		case "while":
			body = "while(" + condition + "){return boundValue}"
		case "do":
			body = "do{return boundValue}while(" + condition + ")"
		case "for-empty":
			body = "for(;" + condition + ";){return boundValue}"
		case "for-let":
			body = "for(let n=0;" + condition + ";n++){return boundValue}"
		case "for-const":
			body = "for(const n=0;" + condition + ";){return boundValue}"
		case "for-expression":
			body = "let n=0;for(n=1;" + condition + ";n++){return boundValue}"
		case "for-init":
			body = "for(let ready=" + condition + ";ready;){return boundValue}"
		case "for-update":
			body = "for(let n=0;n<2;" + condition + "){return boundValue}"
		}
		source := "export function f():unknown {" + body + "}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture.vibe", PathKey: "fixture.vibe"}, source, core.ScriptKindTS)
		if len(file.Diagnostics()) != 0 {
			t.Fatalf("invalid static witness: %v\n%s", file.Diagnostics(), source)
		}
		var binding, trailingComma *ast.Node
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsVariableDeclarationList(node) && node.AsVariableDeclarationList().Declarations.HasTrailingComma() {
				trailingComma = node
			}
			if ast.IsVariableDeclaration(node) && node.Name() != nil && node.Name().Text() == "boundValue" {
				binding = node.Name()
			}
			return node.ForEachChild(visit)
		}
		visit(file.AsNode())
		if trailingComma != nil {
			Gap(t, loopBindingNavigationTarget, fmt.Sprintf("%s/%d/%t/%d/grammar", selected, shape%3, constant, flow%4),
				loopBindingNavigationNativeQuote+"; source without a trailing comma acquired one at %v\n%s", trailingComma.Loc, source)
			return
		}
		if binding == nil {
			t.Fatal("missing loop-head binding")
		}
		position := strings.Index(source, word+" boundValue") + len(word+" ")
		token := astnav.GetTouchingPropertyName(file, position)
		if token != binding {
			Gap(t, loopBindingNavigationTarget, fmt.Sprintf("%s/%d/%t/%d", selected, shape%3, constant, flow%4),
				loopBindingNavigationQuote+" "+loopBindingNavigationNativeQuote+"; source binding at %d hidden by %s %v\n%s", position, token.Kind, token.Loc, source)
		}
	})
}
