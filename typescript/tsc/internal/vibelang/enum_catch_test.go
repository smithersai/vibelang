package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const enumCatchLibrary = `/** @throws {RangeError} */
export declare function number():number
/** @throws {RangeError} */
export declare function tag(parts:TemplateStringsArray):number
export declare const Factory:{
/** @throws {RangeError} */
new():{readonly value:number}
}
`

func TestEnumCallsInCatchingTry(t *testing.T) {
	for _, invocation := range []struct{ name, expr string }{{"call", "number()"}, {"tag", "tag\u0060value\u0060"}, {"construct", "(new Factory()).value"}} {
		for _, context := range []string{"caught", "catch-finally", "finally-only", "unhandled", "deferred-arrow", "deferred-method", "wrapped", "nested-catch", "nested-finally", "catch-body", "finally-body"} {
			for _, ext := range []string{"ts", "d.ts"} {
				t.Run(fmt.Sprintf("%s/%s/%s", invocation.name, context, ext), func(t *testing.T) {
					bad := context == "finally-only" || context == "unhandled" || context == "deferred-arrow" || context == "deferred-method" || context == "catch-body" || context == "finally-body"
					expr := invocation.expr
					if bad {
						expr = "⟦" + expr + "⟧"
					}
					operation := "enum Local{Value=" + expr + "};return Local.Value as number"
					body := "try{" + operation + "}catch{return -1}"
					switch context {
					case "catch-finally":
						body += "finally{}"
					case "finally-only":
						body = "try{" + operation + "}finally{}"
					case "unhandled":
						body = operation
					case "deferred-arrow":
						body = "try{return()=>{" + operation + "}}catch{return undefined}"
					case "deferred-method":
						body = "try{return class{method(){" + operation + "}}}catch{return undefined}"
					case "wrapped":
						body = "return Effect.try(()=>{" + operation + "})"
					case "nested-catch":
						body = "try{return()=>{try{" + operation + "}catch{return -1}}}catch{return undefined}"
					case "nested-finally":
						body = "try{try{" + operation + "}finally{}}catch{return -1}"
					case "catch-body":
						body = "try{return 0}catch{" + operation + "}"
					case "finally-body":
						body = "try{return 0}catch{return 0}finally{" + operation + "}"
					}
					source := "import{number,tag,Factory}from'./lib.js'\nexport function probe(){" + body + "}"
					start, end := strings.Index(source, "⟦"), strings.Index(source, "⟧")-len("⟦")
					source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: enumCatchLibrary})
					count := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						if !bad || d.Source() != diagnosticSource || d.Code() != 401 || d.Pos() > end || d.End() < start {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					want := 0
					if bad {
						want = 1
					}
					if count != want {
						t.Errorf("got %d errors, want %d", count, want)
					}
				})
			}
		}
	}
}
