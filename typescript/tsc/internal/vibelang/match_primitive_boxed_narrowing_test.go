package vibelang

import "testing"

// primitiveClassCases name each primitive class with its primitive type and a
// member that its boxed object has.
var primitiveClassCases = []struct{ class, primitive, member string }{
	{"String", "string", "length"},
	{"Number", "number", "toFixed"},
	{"Boolean", "boolean", "valueOf"},
	{"BigInt", "bigint", "toLocaleString"},
	{"Symbol", "symbol", "description"},
}

// Chapter 004, Typing: a primitive class pattern narrows the subject as its
// test, typeof s === "string" || s instanceof String, does in TypeScript: to
// the primitive or its boxed object. Its false branch removes both.
func TestPrimitiveClassNarrowsToPrimitiveOrBoxed(t *testing.T) {
	eq := "type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n"
	for _, test := range primitiveClassCases {
		both := test.primitive + " | " + test.class
		for name, body := range map[string]string{
			"is":      "export function f(s: unknown) { if (s is " + test.class + ") { return true satisfies Eq<typeof s, " + both + "> } return false }",
			"when":    "export function f(s: unknown) { return match (s) { when " + test.class + ": (true satisfies Eq<typeof s, " + both + ">); default: false; } }",
			"member":  "export function f(s: unknown) { return match (s) { when " + test.class + " and { " + test.member + ": let m }: m; default: 0; } }",
			"not":     "export function f(s: " + both + " | readonly number[]) { return match (s) { when not " + test.class + ": (true satisfies Eq<typeof s, readonly number[]>); default: false; } }",
			"union":   "export function f(s: " + both + " | readonly number[]) { return match (s) { when " + test.class + ": (true satisfies Eq<typeof s, " + both + ">); default: false; } }",
			"typed":   "export function f(s: " + test.primitive + " | readonly number[]) { return match (s) { when " + test.class + ": (true satisfies Eq<typeof s, " + test.primitive + ">); default: false; } }",
			"extract": "export function f(s: unknown) { return match (s) { when " + test.class + "(let v): (true satisfies Eq<typeof v, " + test.primitive + ">); default: false; } }",
		} {
			t.Run(test.class+"/"+name, func(t *testing.T) {
				source := eq + body + "\n"
				for _, d := range errorsOf(t, source) {
					t.Errorf("TS%d %s\n%s", d.Code(), d.String(), source)
				}
			})
		}
	}
}
