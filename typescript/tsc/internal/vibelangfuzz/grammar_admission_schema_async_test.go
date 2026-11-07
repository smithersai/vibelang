package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestGrammarAdmissionSchemaAsyncQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaFieldTypeQuote) {
		t.Fatal("Appendix A Field changed; review async schema-field recovery")
	}
	if !strings.Contains(SpecText("../vips/0029-schema-errors.md"), grammarSchemaErrorTypeQuote) {
		t.Fatal("VIP-29 field mapping changed; review async schema-error fields")
	}
}

// An unresolved schema field reference covers its declaration's native
// modifier diagnostic after reporting the schema type error. Recognize
// the async modifier only before a direct property with a written type.
// A property named async, computed-name expression or method is separate.
func grammarSchemaAsyncField(ts []grammarToken) bool {
	return grammarSchemaModifiedField(ts, "async")
}

func grammarSchemaStaticField(ts []grammarToken) bool {
	return grammarSchemaModifiedField(ts, "static")
}

// Field admits one optional readonly; a repeated readonly is native TS1030,
// which the same unresolved-reference EK2109 covers.
func grammarSchemaDuplicateReadonlyField(ts []grammarToken) bool {
	return grammarSchemaRepeatedModifierField(ts, "readonly", 2)
}

func grammarSchemaModifiedField(ts []grammarToken, modifier string) bool {
	return grammarSchemaRepeatedModifierField(ts, modifier, 1)
}

func grammarSchemaRepeatedModifierField(ts []grammarToken, modifier string, need int) bool {
	return grammarSchemaBodies(ts, func(open int, alias bool) bool {
		return grammarSchemaBodyModifier(ts, open, modifier, need, alias)
	})
}

// A readonly method signature in an object-type alias is native TS1024
// ('readonly' only on a property or index signature); schema mapping reports
// EK2109 for the method and covers it.
func grammarSchemaReadonlyMethod(ts []grammarToken) bool {
	return grammarSchemaModifiedMethod(ts, "readonly")
}

func grammarSchemaAsyncMethod(ts []grammarToken) bool {
	return grammarSchemaModifiedMethod(ts, "async")
}

func grammarSchemaModifiedMethod(ts []grammarToken, modifier string) bool {
	return grammarSchemaBodies(ts, func(open int, alias bool) bool {
		if !alias {
			return false
		}
		depth := 1
		for k := open + 1; k < len(ts) && depth > 0; k++ {
			start := k == open+1 || ts[k].nl || ts[k-1].text == ";" || ts[k-1].text == ","
			if depth == 1 && start {
				at, seen := grammarSchemaModifierPrefix(ts, k, modifier)
				if seen > 0 {
					at = grammarSchemaPropertyEnd(ts, at)
					if at < len(ts) && ts[at].text == "?" {
						at++
					}
					if at < len(ts) && (ts[at].text == "(" || ts[at].text == "<") {
						return true
					}
				}
			}
			switch ts[k].text {
			case "{", "(", "[":
				depth++
			case "}", ")", "]":
				depth--
			}
		}
		return false
	})
}

// grammarSchemaBodies calls body with each schema body's opening brace: a
// named body, or each top-level object type of an alias.
func grammarSchemaBodies(ts []grammarToken, body func(open int, alias bool) bool) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "schema" || i+2 >= len(ts) ||
			ts[i+1].kind != 'w' || ts[i+1].nl ||
			i > 0 && (ts[i-1].text == "." || ts[i-1].text == "?.") {
			continue
		}
		name := i + 1
		if ts[name].text == "error" && name+1 < len(ts) && ts[name+1].kind == 'w' && !ts[name+1].nl {
			continue // Schema-error members retain their separate static rejection.
		}
		if ts[name+1].text != "=" {
			if ts[name+1].text == "{" && body(name+1, false) {
				return true
			}
			continue
		}
		// An alias's type may hold its object types behind parentheses or a
		// type operator (`readonly { … }`, `E ! { … }`); each top-level one
		// is a schema body. Nested object types are field types.
		depth := 0
		for k := name + 2; k < len(ts); k++ {
			if depth == 0 && (ts[k].text == ";" || ts[k].text == "schema" || ts[k].nl && ts[k-1].text == "}") {
				break
			}
			switch ts[k].text {
			case "{":
				if depth == 0 && body(k, true) {
					return true
				}
				depth++
			case "[", "<":
				depth++
			case "}", "]", ">":
				depth--
			}
		}
	}
	return false
}

// grammarSchemaBodyModifier reports a field in the schema body opening at
// ts[open] whose modifier prefix holds modifier at least need times.
func grammarSchemaBodyModifier(ts []grammarToken, open int, modifier string, need int, alias bool) bool {
	depth := 1
	typedBefore := false
	for k := open + 1; k < len(ts) && depth > 0; k++ {
		if depth == 1 && ts[k].text == ":" {
			typedBefore = true
		}
		start := k == open+1 || ts[k].nl || ts[k-1].text == ";" || ts[k-1].text == ","
		if depth == 1 && start {
			at, seen := grammarSchemaModifierPrefix(ts, k, modifier)
			if seen >= need {
				if ts[at].text == "[" {
					brackets := 1
					for at++; at < len(ts) && brackets > 0; at++ {
						if ts[at].text == "[" {
							brackets++
						}
						if ts[at].text == "]" {
							brackets--
						}
					}
				} else if ts[at].kind == 'w' || ts[at].kind == 's' || ts[at].kind == 'n' {
					at++
				} else {
					continue // A field named async has no separate property name.
				}
				if at < len(ts) && ts[at].text == "?" {
					at++
				}
				if at < len(ts) && ts[at].text == ":" {
					return true
				}
				// An untyped static member before another field reports only
				// the same mapped-field diagnostic, as does an untyped async or
				// repeated-readonly member of an object-type alias. A named
				// body rejects the untyped member as syntax.
				untyped := modifier == "static" || alias && (modifier == "async" || need > 1)
				if untyped && at+1 < len(ts) && ts[at].text != "}" && (ts[at].nl || ts[at].text == "," || ts[at].text == ";") {
					return true
				}
				// An alias's last untyped repeated-readonly member may end the
				// object type. A last untyped async member can also lose TS1070
				// when mapping an earlier typed member already failed.
				if alias && (need > 1 || modifier == "async" && typedBefore) && at < len(ts) && ts[at].text == "}" {
					return true
				}
				// TS1030 rejects a repeated modifier on any member, so an
				// alias method signature shares the cover.
				if alias && need > 1 && at < len(ts) && ts[at].text == "(" {
					return true
				}
			}
		}
		switch ts[k].text {
		case "{", "(", "[":
			depth++
		case "}", ")", "]":
			depth--
		}
	}
	return false
}

func TestGrammarAdmissionSchemaAsyncKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema S { static async async id : Missing }":         true,
		"schema S { static async id: Missing }":                true,
		"schema S { async static id: Missing }":                true,
		"schema S { static readonly async id?: Missing }":      true,
		"schema S { readonly static async id: Missing }":       true,
		"schema S { async readonly static id: Missing }":       true,
		"schema S { static static async id: Missing }":         true,
		"schema S { static async 'id': Missing }":              true,
		"schema S { static async [key]: Missing }":             true,
		"schema S { static async readonly: Missing }":          true,
		"schema S { static async async: Missing }":             true,
		"schema S { static async: Missing }":                   false,
		"schema S { static readonly async: Missing }":          false,
		"schema S { static id: Missing }":                      false,
		"schema S { static async() {} }":                       false,
		"schema S { static async m() {} }":                     false,
		"schema S { static async id() {} }":                    false,
		"schema S { static async\nid: Missing }":               false,
		"schema error E { static async id: Missing }":          false,
		"class S { static async m() {} }":                      false,
		"interface S { static async id: Missing }":             false,
		"const o = { schema: { static: 1, async: 2 } };":       false,
		"schema S { async async id: Missing }":                 true,
		"schema S { async async id?: Missing }":                true,
		"schema S { readonly async async id: Missing }":        true,
		"schema S { async async readonly id: Missing }":        true,
		"schema S { async async: Missing }":                    true,
		"schema S { async readonly: Missing }":                 true,
		"schema S { readonly readonly async: Missing }":        false,
		"schema S { async async() {} }":                        false,
		"schema S { async async\nid: Missing }":                false,
		"schema S { async id: Missing }":                       true,
		"schema S { async id: string }":                        true,
		"schema S { async id?: string }":                       true,
		"schema S { readonly async id: string }":               true,
		"schema S { async readonly id: string }":               true,
		"schema S { async 'id': string }":                      true,
		"schema S { async [key]: string }":                     true,
		"schema S { id: string;\nasync next: number }":         true,
		"schema error E { async id: string }":                  false,
		"schema S { async: string }":                           false,
		"schema S { readonly async: string }":                  false,
		"schema S { async?: string }":                          false,
		"schema S { [async]: string }":                         false,
		"schema S { async\nid: string }":                       false,
		"schema\nS { async id: string }":                       false,
		"schema S { id: string } const o = { async id() {} };": false,
		"schema error E { async id() { return 'x'; } }":        false,
		"error E { async id: string }":                         false,
		"interface S { async id: string }":                     false,
		"obj.schema S { async id: string }":                    false,
	} {
		if got := grammarSchemaAsyncField(grammarLexSource(source)); got != want {
			t.Errorf("async field=%v,want %v: %s", got, want, source)
		}
		if got := grammarAdmissionForm(source); (got == "admission:schema-async-field") != want {
			t.Errorf("key=%q,want async family=%v: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaAsyncRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S { static async async id : Missing }",
		"schema S { static async id: Missing }",
		"schema S { async static id: Missing }",
		"schema S { static readonly async id?: Missing }",
		"schema S { readonly static async id: Missing }",
		"schema S { static async 'id': Missing }",
		"schema S { static async [key]: Missing }",
		"schema S { static async readonly: Missing }",
		"schema S { async id: Missing }",
		"schema S { async async id: Missing }",
		"schema S { async async id?: Missing }",
		"schema S { readonly async async id: Missing }",
		"schema S { async id?: Missing }",
		"schema S { async 'id': Missing }",
		"schema S { readonly async id: Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("async schema property no longer exposes an admission gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"schema S { static async: string }",
		"schema S { static id: string }",
		"schema S { static readonly id: string }",
		"schema S { static async id: string }",
		"schema S { static async m() {} }",
		"schema error E { static async id: string }",
		"interface S { static async id: string }",
		"class S { static async m() {} }",
		"schema S { async: string }",
		"schema S { readonly async?: string }",
		"schema S { async id: string }",
		"schema S { async id?: string }",
		"schema S { async 'id': string }",
		"schema error E { async id: string }",
		"schema S { id: string }",
		"interface S { async id: string }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("native control became an admission mismatch")
			}
		})
	}
}

// grammarSchemaModifierPrefix separates modifiers from a member named with
// the same word. Only static can continue its modifier across a line break.
func grammarSchemaModifierPrefix(ts []grammarToken, at int, modifier string) (int, int) {
	seen := 0
modifiers:
	for at+1 < len(ts) && (!ts[at+1].nl || ts[at].text == "static") &&
		(ts[at].text == "async" || ts[at].text == "readonly" || ts[at].text == "static" || ts[at].text == "effect") {
		switch ts[at+1].text {
		case ":", "?", "(", "<", ";", ",":
			break modifiers
		}
		if ts[at].text == modifier {
			seen++
		}
		at++
	}
	return at, seen
}

// grammarSchemaPropertyEnd skips one direct property name, including a
// computed name. It leaves other tokens in place.
func grammarSchemaPropertyEnd(ts []grammarToken, at int) int {
	if at >= len(ts) {
		return at
	}
	if ts[at].text == "[" {
		depth := 1
		for at++; at < len(ts) && depth > 0; at++ {
			switch ts[at].text {
			case "[":
				depth++
			case "]":
				depth--
			}
		}
		return at
	}
	if ts[at].kind == 'w' || ts[at].kind == 's' || ts[at].kind == 'n' {
		return at + 1
	}
	return at
}

// grammarParameterPatternStart reports a binding pattern or rest parameter
// after a parameter modifier.
func grammarParameterPatternStart(t grammarToken) bool {
	return t.text == "{" || t.text == "[" || t.text == "..."
}

// A schema alias can cover the native rejection of a parameter modifier in
// a call or method signature with EK2109 for the unsupported member. A
// modifier precedes a name, a binding pattern or a rest parameter, as
// TypeScript's canFollowModifier allows; async must share the line with it.
func grammarSchemaSignatureParameterModifier(ts []grammarToken) bool {
	return grammarSchemaBodies(ts, func(open int, alias bool) bool {
		if !alias {
			return false
		}
		depth := 1
		for k := open + 1; k < len(ts) && depth > 0; k++ {
			if depth == 1 && ts[k].text == "(" {
				for at, nested := k+1, 1; at+1 < len(ts) && nested > 0; at++ {
					if nested == 1 && (at == k+1 || ts[at-1].text == ",") {
						next := ts[at+1]
						switch ts[at].text {
						case "static", "readonly", "public", "private", "protected":
							if next.kind == 'w' || grammarParameterPatternStart(next) {
								return true
							}
						case "async":
							if !next.nl && (next.kind == 'w' || grammarParameterPatternStart(next)) {
								return true
							}
						}
					}
					switch ts[at].text {
					case "(", "[", "{":
						nested++
					case ")", "]", "}":
						nested--
					}
				}
			}
			switch ts[k].text {
			case "(", "[", "{":
				depth++
			case ")", "]", "}":
				depth--
			}
		}
		return false
	})
}
