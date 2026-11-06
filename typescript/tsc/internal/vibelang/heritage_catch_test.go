package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const heritageCatchLibrary = `export class Base{}
/** @throws {RangeError} */
export declare function parent():typeof Base
/** @throws {RangeError} */
export declare function tag(parts:TemplateStringsArray):typeof Base
export declare const Factory:{
/** @throws {RangeError} */
new():typeof Base
}
`

func TestHeritageCallsInCatchingTry(t *testing.T) {
	for _, invocation := range []struct{ name, expr string }{{"call", "parent()"}, {"tag", "tag\u0060base\u0060"}, {"construct", "new Factory()"}} {
		for _, style := range []string{"expression", "declaration"} {
			for _, context := range []string{"caught", "catch-finally", "finally-only", "unhandled", "deferred-arrow", "deferred-method", "wrapped", "nested-extends"} {
				for _, ext := range []string{"ts", "d.ts"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", invocation.name, style, context, ext), func(t *testing.T) {
						bad := context == "finally-only" || context == "unhandled" || context == "deferred-arrow" || context == "deferred-method"
						expr := invocation.expr
						if bad {
							expr = "⟦" + expr + "⟧"
						}
						operation := "return class extends " + expr + "{}"
						if style == "declaration" {
							operation = "class Local extends " + expr + "{};return Local"
						}
						body := "try{" + operation + "}catch{return undefined}"
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
						case "nested-extends":
							body = "try{return class extends(class extends " + expr + "{}){}}catch{return undefined}"
						}
						source := "import{parent,tag,Factory}from'./lib.js'\nexport function probe(){" + body + "}"
						start, end := strings.Index(source, "⟦"), strings.Index(source, "⟧")-len("⟦")
						source = strings.ReplaceAll(strings.ReplaceAll(source, "⟦", ""), "⟧", "")
						p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: heritageCatchLibrary})
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
}
