package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestConcurrentHeadTypeAnnotation(t *testing.T) {
	errors := func(t *testing.T, loop, head, items, body string, unused bool) []string {
		t.Helper()
		source := "export effect function f(xs:number[], rows:Array<{n?:number}>, matrix:number[][]) { " + loop + " (" + head + " of " + items + ") { " + body + " } }"
		at := strings.Index(source, head)
		if loop == "for" {
			// Use equally wide ordinary expressions in the TypeScript
			// grammar control to isolate annotation diagnostics.
			defaultValue := "(matrix is [let first] ? first.length : 0)"
			itemsValue := "(rows is [let first] ? (void first, rows) : rows)"
			source = strings.ReplaceAll(source, defaultValue, "(0"+strings.Repeat(" ", len(defaultValue)-3)+")")
			source = strings.ReplaceAll(source, itemsValue, "(rows"+strings.Repeat(" ", len(itemsValue)-6)+")")
		}
		p, f, _, _ := editorProgram(t, source)
		if unused {
			p.Options().NoUnusedLocals = core.TSTrue
		}
		var got []string
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, fmt.Sprintf("%s%d:%d+%d:%s", d.Source(), d.Code(), d.Pos()-at, d.Len(), d.String()))
			}
		}
		slices.Sort(got)
		return got
	}
	for index, row := range []struct{ key, binding, annotation, items, body string }{
		{"unique-default-is", "{n = (matrix is [let first] ? first.length : 0)}", "unique symbol", "rows", "void n"},
		{"unique-operand-is", "{n}", "unique symbol", "(rows is [let first] ? (void first, rows) : rows)", "void n"},
		{"unique-symbol", "x", "unique symbol", "xs", "void x"},
		{"unique-parentheses", "x", "((unique symbol))", "xs", "void x"},
		{"unique-object", "{n}", "unique symbol", "rows", "void n"},
		{"unique-array", "[n]", "unique symbol", "matrix", "void n"},
		{"identifier", "x", "number", "xs", "const n:number=x;void n"},
		{"ignored-type", "x", "string", "xs", "const n:number=x;void n"},
		{"object", "{n=1}", "{n?:string}", "rows", "const value:number=n;void value"},
		{"array", "[n=1]", "string[]", "matrix", "const value:number=n;void value"},
		{"tuple", "[n]", "readonly [string]", "matrix", "void n"},
		{"missing-type", "x", "Missing", "xs", "void x"},
		{"missing-generic", "x", "Array<Missing>", "xs", "void x"},
		{"type-query", "x", "typeof missing", "xs", "void x"},
		{"temporary-name", "x", "$concurrentHeadType", "xs", "void x"},
		{"function-type", "x", "(n: Missing) => number", "xs", "void x"},
		{"literal-type", "x", "1", "xs", "const value:number=x;void value"},
		{"const-name", "x", "const", "xs", "void x"},
		{"never-type", "x", "never", "xs", "const value:number=x;void value"},
		{"head-query", "x", "typeof x", "xs", "void x"},
		{"body-error", "x", "number", "xs", "const n:string=x;void n"},
		{"independent-grammar", "x", "number", "xs", "for(const y:string of xs){void y}void x"},
		{"operand-error", "x", "number", "xs.map((n)=>missing(n))", "void x"},
		{"all-errors", "x", "Missing", "xs", "void absent"},
	} {
		for _, kind := range []string{"const", "let"} {
			limit := []string{"", "(1)", "(2)"}[index%3]
			unused := kind == "let" && row.key != "unique-operand-is"
			t.Run(fmt.Sprintf("%s/%s/%s/unused=%t", row.key, kind, limit, unused), func(t *testing.T) {
				head := kind + " " + row.binding + ": " + row.annotation
				want := errors(t, "for", head, row.items, row.body, unused)
				if !slices.ContainsFunc(want, func(s string) bool { return strings.HasPrefix(s, "2483:") }) {
					t.Fatalf("native control lacks TS2483: %v", want)
				}
				got := errors(t, "for concurrent"+limit, head, row.items, row.body, unused)
				if !slices.Equal(got, want) {
					t.Fatalf("native: %v\nconcurrent: %v", want, got)
				}
			})
		}
	}
}

func TestConcurrentHeadTypeAnnotationNoCheck(t *testing.T) {
	for _, loop := range []string{"for", "for concurrent", "for concurrent(1)"} {
		source := "export effect function f(xs:number[]){" + loop + "(const x:string of xs){const n:number=x;void n}}"
		p, f, _, _ := editorProgram(t, source)
		p.Options().NoCheck = core.TSTrue
		got := append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...)
		for _, d := range got {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s with noCheck: %v", loop, d)
			}
		}
	}
}

func TestConcurrentHeadTypeAnnotationLooseNullChecks(t *testing.T) {
	for _, typ := range []string{"never", "const", "Missing"} {
		var reference []string
		for _, loop := range []string{"for", "for concurrent"} {
			source := "export effect function f(xs:number[]){" + loop + "(const x:" + typ + " of xs){void x}}"
			p, f, _, _ := editorProgram(t, source)
			p.Options().StrictNullChecks = core.TSFalse
			at := strings.Index(source, "const x")
			var got []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, fmt.Sprintf("%s%d:%d+%d:%s", d.Source(), d.Code(), d.Pos()-at, d.Len(), d.String()))
				}
			}
			slices.Sort(got)
			if loop == "for" {
				reference = got
			} else if !slices.Equal(got, reference) {
				t.Errorf("%s: native %v, concurrent %v", typ, reference, got)
			}
		}
	}
}
