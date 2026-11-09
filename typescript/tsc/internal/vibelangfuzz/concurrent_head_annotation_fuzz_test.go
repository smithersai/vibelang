package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentHeadAnnotationTarget = "FuzzConcurrentHeadAnnotation"
const concurrentHeadAnnotationQuote = "`ForDeclaration` is ECMAScript's, `LetOrConst ForBinding`"

func TestConcurrentHeadAnnotationQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", concurrentHeadAnnotationQuote)
	chapterSays(t, "007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript")
}

// The source declaration is a native ForBinding. Compare recovery of a
// rejected annotation, including independent type-name and body errors,
// with the same declaration in a native for-of; the invalid annotation
// never governs the native binding's inferred type.
func FuzzConcurrentHeadAnnotation(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", concurrentHeadAnnotationQuote)
	rows := []struct{ key, binding, annotation, items, body string }{
		{"unique-default-is", "{n = (matrix is [let first] ? first.length : 0)}", "unique symbol", "rows", "void n"},
		{"unique-operand-is", "{n}", "unique symbol", "(rows is [let first] ? (void first, rows) : rows)", "void n"},
		{"unique-symbol", "x", "unique symbol", "xs", "void x"},
		{"unique-parentheses", "x", "((unique symbol))", "xs", "void x"},
		{"unique-object", "{n}", "unique symbol", "rows", "void n"},
		{"unique-array", "[n]", "unique symbol", "matrix", "void n"},
		{"identifier", "x", "number", "xs", "const value:number=x;void value"},
		{"ignored-type", "x", "string", "xs", "const value:number=x;void value"},
		{"object", "{n=1}", "{n?:string}", "rows", "const value:number=n;void value"},
		{"array", "[n=1]", "string[]", "matrix", "const value:number=n;void value"},
		{"missing-type", "x", "Missing", "xs", "void x"},
		{"type-query", "x", "typeof missing", "xs", "void x"},
		{"temporary-name", "x", "$concurrentHeadType", "xs", "void x"},
		{"function-type", "x", "(n: Missing) => number", "xs", "void x"},
		{"head-query", "x", "typeof x", "xs", "void x"},
		{"const-name", "x", "const", "xs", "void x"},
		{"never-type", "x", "never", "xs", "void x"},
		{"body-error", "x", "number", "xs", "const value:string=x;void value"},
		{"independent-grammar", "x", "number", "xs", "for(const y:string of xs){void y}void x"},
		{"operand-error", "x", "number", "xs.map((n)=>missing(n))", "void x"},
		{"combined", "x", "Array<Missing>", "xs", "void absent"},
		{"plain-identifier", "x", "", "xs", "void x"},
		{"plain-pattern", "{n=1}", "", "rows", "void n"},
	}
	keys := make([]string, len(rows))
	for i, row := range rows {
		keys[i] = row.key
		f.Add([]byte(row.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestConcurrentHeadAnnotationQuoted(t)
		selected, tail := keyedChoice(keys, data)
		row := rows[selected]
		bits := byte(0)
		if len(tail) > 0 {
			bits = tail[0]
		}
		head := []string{"const ", "let "}[bits%2] + row.binding
		if row.annotation != "" {
			typ := row.annotation
			if bits&8 != 0 {
				typ = "(" + typ + ")"
			}
			head += []string{": ", " /* type */ : "}[int(bits/16)%2] + typ
		}
		limit := []string{"", "(1)", "(2)", "(\"unbounded\")"}[int(bits/2)%4]
		errors := func(loop string) ([]string, string) {
			source := "export effect function f(xs:number[],rows:Array<{n?:number}>,matrix:number[][]){" + loop + "(" + head + " of " + row.items + "){" + row.body + "}}"
			at := strings.Index(source, head)
			if loop == "for" {
				// Use equally wide ordinary expressions in the TypeScript
				// grammar control to isolate annotation diagnostics.
				defaultValue := "(matrix is [let first] ? first.length : 0)"
				itemsValue := "(rows is [let first] ? (void first, rows) : rows)"
				source = strings.ReplaceAll(source, defaultValue, "(0"+strings.Repeat(" ", len(defaultValue)-3)+")")
				source = strings.ReplaceAll(source, itemsValue, "(rows"+strings.Repeat(" ", len(itemsValue)-6)+")")
			}
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var got []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, fmt.Sprintf("%s%d@%d+%d:%s", d.Source(), d.Code(), d.Pos()-at, d.Len(), d.String()))
				}
			}
			slices.Sort(got)
			return got, source
		}
		want, _ := errors("for")
		got, source := errors("for concurrent" + limit)
		key := "head:" + row.key
		if !slices.Equal(got, want) {
			Gap(t, concurrentHeadAnnotationTarget, key, "%s; native %v, concurrent %v\n%s", concurrentHeadAnnotationQuote, want, got, source)
		}
		ExpectPending(t, concurrentHeadAnnotationTarget, key)
		ExpectPending(t, concurrentHeadAnnotationTarget, specCorpusKey(t))
	})
}
