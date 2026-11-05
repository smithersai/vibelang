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

func grammarSchemaModifiedField(ts []grammarToken, modifier string) bool {
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
		open := name + 1
		if open < len(ts) && ts[open].text == "=" {
			open++
			for open < len(ts) && ts[open].text == "(" {
				open++
			}
		}
		if open >= len(ts) || ts[open].text != "{" {
			continue
		}
		depth := 1
		for k := open + 1; k < len(ts) && depth > 0; k++ {
			at := k
			start := k == open+1 || ts[k].nl || ts[k-1].text == ";" || ts[k-1].text == ","
			if depth == 1 && start {
				hasModifier := false
			modifiers:
				// Native static modifiers may span a line break; async and readonly may not.
				for at+1 < len(ts) && (!ts[at+1].nl || ts[at].text == "static") && (ts[at].text == "async" || ts[at].text == "readonly" || ts[at].text == "static") {
					// The last keyword may itself be the property name.
					switch ts[at+1].text {
					case ":", "?", "(", "<":
						break modifiers
					}
					hasModifier = hasModifier || ts[at].text == modifier
					at++
				}
				if hasModifier {
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
				}
			}
			switch ts[k].text {
			case "{", "(", "[":
				depth++
			case "}", ")", "]":
				depth--
			}
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
