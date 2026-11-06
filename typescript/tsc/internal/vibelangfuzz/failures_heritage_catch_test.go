package vibelangfuzz

import (
	"strings"
	"testing"
)

const heritageCatchQuote = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."

func TestHeritageCatchQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), heritageCatchQuote) {
		t.Fatal("heritage catch rule changed")
	}
}

func failuresHeritageCatchCases() []*failCase {
	const lib = `export class Base{}
/** @throws {RangeError} */
export declare function parent():typeof Base
/** @throws {RangeError} */
export declare function tag(parts:TemplateStringsArray):typeof Base
export declare const Factory:{
/** @throws {RangeError} */
new():typeof Base
}
`
	var cases []*failCase
	for _, invocation := range []struct{ name, expr string }{{"call", "parent()"}, {"tag", "tag\u0060base\u0060"}, {"construct", "new Factory()"}} {
		for _, style := range []string{"expression", "declaration"} {
			for _, context := range []string{"caught", "catch-finally", "finally-only", "unhandled", "deferred-arrow", "deferred-method", "wrapped", "nested-extends"} {
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
				code := 0
				if bad {
					code = 401
				}
				cases = append(cases, &failCase{Name: "heritage-catch-" + invocation.name + "-" + style + "-" + context, Quote: heritageCatchQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code})
			}
		}
	}
	return cases
}
