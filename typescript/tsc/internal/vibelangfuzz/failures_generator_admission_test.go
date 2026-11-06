package vibelangfuzz

import (
	"strings"
	"testing"
)

const generatorPlainCallsQuote = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function."

func TestGeneratorPlainCallsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(failuresChapter), generatorPlainCallsQuote) {
		t.Fatalf("plain generator call rule changed: %q", generatorPlainCallsQuote)
	}
}

func failuresGeneratorAdmissionCases() []*failCase {
	const lib = `/** @throws {RangeError} */
export declare function risky():number
export type Admitted<T> = {
/** @throws {unknown} */
():T
}
/** @throws {never} */
export declare function accept<T>(f:Admitted<T>):T
/** @throws {never} @rethrows f */
export declare function invoke<T>(f:()=>T):T
`
	var cases []*failCase
	for _, row := range []struct {
		key, body string
		code      int
	}{
		{"foreign", "accept(function*(){yield ⟦risky()⟧})", 401},
		{"wrapped", "Effect.try(function*(){yield ⟦risky()⟧})", 401},
		{"options", "Effect.try({try:function*(){yield ⟦risky()⟧},catch:(e)=>e})", 401},
		{"parentheses", "Effect.try((function*(){yield ⟦risky()⟧}))", 401},
		{"executor", "new Promise(function*(resolve){yield ⟦risky()⟧})", 401},
		{"caught-wrapper", "(()=>{try{return Effect.try(function*(){yield ⟦risky()⟧})}catch{return undefined}})()", 401},
		{"rethrows", "Effect.try(function*(){yield ⟦invoke(()=>risky())⟧})", 401},
		{"nested", "Effect.try(()=>function*(){yield ⟦risky()⟧})", 401},
		{"ordinary", "(function*(){yield ⟦risky()⟧})", 401},
		{"foreign-plain", "accept(function(){return risky()})", 0},
		{"wrapped-plain", "Effect.try(function(){return risky()})", 0},
		{"foreign-async", "accept(async function*(){yield risky()})", 0},
		{"wrapped-async", "Effect.try(async function*(){yield risky()})", 0},
		{"foreign-caught", "accept(function*(){try{yield risky()}catch{}})", 0},
		{"wrapped-caught", "Effect.try(function*(){try{yield risky()}catch{}})", 0},
		{"safe", "accept(function*(){yield 7})", 0},
		{"wrapped-default", "Effect.try(function*(x=risky()){yield x})", 0},
		{"foreign-default", "accept(function*(x=risky()){yield x})", 0},
		{"async-default", "Effect.try(async function*(x=risky()){yield x})", 0},
		{"inner-wrapper", "Effect.try(function*(){yield Effect.try(()=>risky())})", 0},
	} {
		cases = append(cases, &failCase{Name: "generator-admission-" + row.key, Quote: generatorPlainCallsQuote, VIP: 4, Host: "top", Lib: lib, Body: "export const value=" + row.body, Code: row.code, OneDiagnostic: row.code != 0})
	}
	return cases
}
