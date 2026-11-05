package vibelangfuzz

import (
	"strings"
	"testing"
)

// VIP-4 contracts travel with the selected signature, across source/declaration
// boundaries and aliases. FuzzFailuresSpec mutates file kind and module placement.
func failuresForeignGateCases() []*failCase {
	const quote = "In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`."
	var cases []*failCase
	for _, bound := range []string{"never", "RangeError", "unknown", "\"bad\""} {
		key := bound
		if bound == "\"bad\"" {
			key = "literal"
		}
		tag := "/** @throws {" + bound + "} */"
		for _, shape := range []struct{ name, lib, decls, call string }{
			{"function", tag + "\nexport declare function read(s: string): string", "", "read(s)"},
			{"alias", tag + "\nexport declare function read(s: string): string", "const alias = read", "alias(s)"},
			{"optional", tag + "\nexport declare function read(s: string): string", "", "read?.(s)"},
			{"member", "export interface Reader {\n" + tag + "\nread(s: string): string\n}\nexport declare const reader: Reader", "", "reader.read(s)"},
			{"signature", "export declare const read: {\n" + tag + "\n(s: string): string\n}", "", "read(s)"},
			{"binding", "type Reader = (s: string) => string\n" + tag + "\nexport declare const read: Reader", "", "read(s)"},
			{"returned", "export declare function decoder(): {\n" + tag + "\n(s: string): string\n}", "const read = decoder()", "read(s)"},
			{"overload", tag + "\nexport declare function read(s: string): string\n/** @throws {never} */\nexport declare function read(n: number): number", "", "read(s)"},
		} {
			// decoder() is foreign without a contract; build it at module initialization.
			body := shape.call
			if bound != "never" {
				body = "⟦" + body + "⟧"
			}
			cases = append(cases, &failCase{Name: "foreign-gate-" + shape.name + "-" + key, Quote: quote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Code: 403, Lib: shape.lib, Decls: shape.decls, Body: body})
			cases = append(cases, &failCase{Name: "foreign-gate-wrapped-" + shape.name + "-" + key, Quote: quote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Lib: shape.lib, Decls: shape.decls, Body: "const value = try Effect.try(() => " + shape.call + ")"})
		}
	}
	cases = append(cases, &failCase{Name: "foreign-gate-overload-selected-never", Quote: quote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Lib: "/** @throws {RangeError} */\nexport declare function read(s: string): string\n/** @throws {never} */\nexport declare function read(n: number): number", Body: "read(1)"})

	for _, bound := range []struct{ key, text string }{{"private", "Hidden"}, {"mixed-private", "RangeError | Hidden"}} {
		tag := "/** @throws {" + bound.text + "} */"
		for _, shape := range []struct{ name, lib string }{
			{"function", tag + "\nexport declare function read(s: string): string"},
			{"binding", tag + "\nexport declare const read: (s: string) => string"},
		} {
			lib := "declare class Hidden extends Error {}\n" + shape.lib
			key := "foreign-gate-" + shape.name + "-" + bound.key
			cases = append(cases, &failCase{Name: key, Quote: quote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Code: 403, Lib: lib, Body: "⟦read(s)⟧"})
			cases = append(cases, &failCase{Name: key + "-wrapped", Quote: quote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Lib: lib, Body: "const value = try Effect.try(() => read(s))"})
		}
	}

	const dynamicQuote = "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives."
	for _, typ := range []string{"any", "Function"} {
		for _, shape := range []struct{ name, decls, call string }{
			{"binding", "declare const read: " + typ, "read(s)"},
			{"optional", "declare const read: " + typ, "read?.(s)"},
			{"alias", "declare const original: " + typ + "\nconst read = original", "read(s)"},
			{"member", "declare const holder: { read: " + typ + " }", "holder.read(s)"},
		} {
			key := "foreign-gate-dynamic-" + strings.ToLower(typ) + "-" + shape.name
			cases = append(cases, &failCase{Name: key, Quote: dynamicQuote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Code: 403, Decls: shape.decls, Body: "⟦" + shape.call + "⟧"})
			cases = append(cases, &failCase{Name: key + "-wrapped", Quote: dynamicQuote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Decls: shape.decls, Body: "const value = try Effect.try(() => " + shape.call + ")"})
		}
		key := "foreign-gate-dynamic-" + strings.ToLower(typ) + "-parameter"
		cases = append(cases, &failCase{Name: key, Quote: dynamicQuote, VIP: 4, Owner: "conf-auto-foreign-call-throws-gate", Code: 403, Host: "none", Body: "export effect function probe(read: " + typ + ") { return ⟦read()⟧ }"})
	}
	return cases
}

func TestForeignThrowsGate(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range failuresForeignGateCases() {
		t.Run(c.Name, func(t *testing.T) { checkFailures(t, w, c, 0) })
	}
}

func TestForeignThrowsGateQuoted(t *testing.T) {
	for _, c := range failuresForeignGateCases() {
		if !strings.Contains(SpecText(c.chapter()), c.Quote) {
			t.Errorf("%s no longer quotes its chapter", c.Name)
		}
	}
}
