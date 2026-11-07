package vibelangfuzz

import (
	"strings"
	"testing"
)

const enumCatchQuote = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."

func TestEnumCatchQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), enumCatchQuote) {
		t.Fatal("enum catch rule changed")
	}
}

func failuresEnumCatchCases() []*failCase {
	const lib = `/** @throws {RangeError} */
export declare function number():number
/** @throws {RangeError} */
export declare function tag(parts:TemplateStringsArray):number
export declare const Factory:{
/** @throws {RangeError} */
new():{readonly value:number}
}
`
	var cases []*failCase
	for _, invocation := range []struct{ name, expr string }{{"call", "number()"}, {"tag", "tag\u0060value\u0060"}, {"construct", "(new Factory()).value"}} {
		for _, context := range []string{"caught", "catch-finally", "finally-only", "unhandled", "deferred-arrow", "deferred-method", "wrapped", "nested-catch", "nested-finally", "catch-body", "finally-body"} {
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
			code := 0
			if bad {
				code = 401
			}
			cases = append(cases, &failCase{Name: "enum-catch-" + invocation.name + "-" + context, Quote: enumCatchQuote, VIP: 4, Host: "plain", Lib: lib, Body: body, Code: code})
		}
	}
	return cases
}
