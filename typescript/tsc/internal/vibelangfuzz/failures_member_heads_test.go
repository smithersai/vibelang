package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const memberHeadPlainQuote = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."
const memberHeadEffectQuote = "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |"

func TestMemberHeadThrowsQuoted(t *testing.T) {
	for _, quote := range []string{memberHeadPlainQuote, memberHeadEffectQuote} {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Fatalf("member head throws rule changed: %s", quote)
		}
	}
}

func failuresMemberHeadCases() []*failCase {
	const lib = `/** @throws {RangeError} */
export declare function key(): "value"
/** @throws {RangeError} */
export declare function tag(parts: TemplateStringsArray): "value"
export declare const Key: {
/** @throws {RangeError} */
new(): { readonly value: "value" }
}
/** @throws {RangeError} */
export declare function decorator(): any
`
	var cases []*failCase
	for _, invocation := range []struct{ name, expr string }{
		{"call", "key()"}, {"tag", "tag`name`"}, {"new", "(new Key()).value"},
	} {
		for _, shape := range []struct{ name, body string }{
			{"method", "class Local { [%s]() {} }"},
			{"getter", "class Local { get [%s]() { return 1 } }"},
			{"static", "class Local { static [%s]() {} }"},
			{"object", "const local = { [%s]() {} }"},
			{"error", "error Local { [%s]() {} }"},
			{"schema-error", "schema error Local { [%s]() {} }"},
		} {
			for _, context := range []string{"effect", "plain", "caught", "wrapped", "async", "nested"} {
				expr, code, quote, host := invocation.expr, 0, memberHeadPlainQuote, "plain"
				switch context {
				case "effect":
					code, quote, host = 403, memberHeadEffectQuote, "effect"
				case "plain", "nested":
					code = 401
				case "async":
					host = "async"
				case "wrapped":
					host = "effect"
				}
				if code != 0 {
					expr = "⟦" + expr + "⟧"
				}
				body := fmt.Sprintf(shape.body, expr)
				switch context {
				case "caught":
					body = "try {" + body + "} catch {}"
				case "wrapped":
					body = "return try Effect.try(() => {" + body + "})"
				case "nested":
					body, host = "function nested() {"+body+"}", "effect"
				}
				cases = append(cases, &failCase{Name: "member-head-" + invocation.name + "-" + shape.name + "-" + context, Quote: quote, VIP: 4, Lib: lib, Host: host, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	for _, shape := range []struct{ name, body string }{
		{"method", "class Local { @(%s) method() {} }"},
		{"field", "class Local { @(%s) value = 1 }"},
		{"class", "@(%s) class Local {}"},
	} {
		for _, context := range []string{"effect", "plain", "caught", "wrapped"} {
			expr, code, quote, host := "decorator()", 0, memberHeadPlainQuote, "plain"
			if context == "effect" {
				code, quote, host = 403, memberHeadEffectQuote, "effect"
			}
			if context == "plain" {
				code = 401
			}
			if code != 0 {
				expr = "⟦" + expr + "⟧"
			}
			body := fmt.Sprintf(shape.body, expr)
			if context == "caught" {
				body = "try {" + body + "} catch {}"
			}
			if context == "wrapped" {
				body, host = "return try Effect.try(() => {"+body+"})", "effect"
			}
			cases = append(cases, &failCase{Name: "member-decorator-" + shape.name + "-" + context, Quote: quote, VIP: 4, Lib: lib, Host: host, Body: body, Code: code, OneDiagnostic: code != 0})
		}
	}
	return cases
}
