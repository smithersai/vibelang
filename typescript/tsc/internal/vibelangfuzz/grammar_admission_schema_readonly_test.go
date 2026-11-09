package vibelangfuzz

import (
	"context"
	"testing"
)

// Field = "readonly"? PropertyName "?"? ":" Type admits one readonly. A
// repeated readonly is TypeScript's TS1030 when the field type resolves; an
// unresolved schema reference reports EK2109 instead and covers it.
func TestGrammarAdmissionSchemaDuplicateReadonlyKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema S { readonly readonly id : Missing }":                             true,
		"schema S { readonly readonly id?: Missing }":                             true,
		"schema S { readonly readonly 'id': Missing }":                            true,
		"schema S { readonly readonly [key]: Missing }":                           true,
		"schema S { readonly readonly readonly: Missing }":                        true,
		"schema S { id: string;\nreadonly readonly n: Missing }":                  true,
		"schema S = { readonly readonly id: Missing };":                           true,
		"schema S = {\nreadonly readonly readonly\nid\nid : Missing } ;":          true,
		"schema fork = { readonly readonly readonly\nid\nid : error } ;":          true,
		"schema S = readonly { readonly readonly readonly id : Missing } ;":       true,
		"schema S = join ! { readonly readonly id : Missing } ;":                  true,
		"schema S = readonly { readonly readonly Missing }":                       true,
		"schema S\n= { readonly readonly readonly id ( )\n}":                      true,
		"schema S = { a: { readonly readonly id: Missing } };":                    false,
		"schema S { readonly readonly readonly\nid: Missing }":                    false,
		"schema S = { id: Missing }\nschema T { readonly readonly\nid: Missing }": false,
		"schema S { readonly id: Missing }":                                       false,
		"schema S { readonly readonly: Missing }":                                 false,
		"schema S { readonly\nreadonly id: Missing }":                             false,
		"schema S { readonly readonly() {} }":                                     false,
		"schema error E { readonly readonly id: Missing }":                        false,
		"interface S { readonly readonly id: Missing }":                           false,
		"class S { readonly readonly id: Missing }":                               false,
		"obj.schema S { readonly readonly id: Missing }":                          false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:schema-duplicate-readonly") != want {
			t.Errorf("key=%q,want duplicate readonly=%v: %s", got, want, source)
		}
	}
	// The async and static families keep their keys when readonly repeats.
	for source, want := range map[string]string{
		"schema S { readonly readonly readonly static async async id : Missing }": "admission:schema-async-field",
		"schema S { readonly readonly static id : Missing }":                      "admission:schema-static-field",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q,want %q: %s", got, want, source)
		}
	}
}

// An object-type alias reads `async async` before a line break as an async
// modifier on a property named async with no type. EK2109 for that untyped
// field covers the native modifier rejection. A named body rejects the same
// member as syntax, so it stays outside the family.
func TestGrammarAdmissionSchemaAsyncUntypedAliasKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema S = { async async\nid : Missing\n}":         true,
		"schema S = { async async ;\nid :\nMissing\n}":      true,
		"schema S = { async async, id: Missing };":          true,
		"schema S = { readonly async async\nid: Missing };": true,
		"schema S = { async\nid: Missing };":                false,
		"schema S = { async async }":                        false,
		"schema S { async async\nid: Missing }":             false,
		"type S = { async async\nid: Missing };":            false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:schema-async-field") != want {
			t.Errorf("key=%q,want async family=%v: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaDuplicateReadonlyRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A field of a schema body or of an object-type alias keeps TS1030 or
	// TS1070 beside the EK2109 of its unresolved type: no admission gap.
	for _, source := range []string{
		"schema S { readonly readonly id : Missing }",
		"schema S { readonly readonly id?: Missing }",
		"schema S = { readonly readonly id: Missing };",
		"schema S = {\nreadonly readonly readonly\nid\nid : Missing } ;",
		"schema S = { async async\nid : Missing\n}",
		"schema S = { async async ;\nid :\nMissing\n}",
		"schema S = { async async, id: Missing };",
		"schema S\n= { readonly readonly readonly id ( )\n}",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				result, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected schema field is an admission gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	// A type operator or an Effect type over the object type maps to an
	// unsupported member that erases the written modifiers: still pending
	// under the same key.
	for _, source := range []string{
		"schema S = readonly { readonly readonly readonly id : Missing } ;",
		"schema S = join ! { readonly readonly id : Missing } ;",
		"schema S = readonly { readonly readonly Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				result, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("schema modifier witness no longer exposes an admission gap; diagnostics=%v", result.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// With a resolved field type the native rejection is visible.
	for _, source := range []string{
		"schema S { readonly readonly id: string }",
		"schema S { readonly id: Missing }",
		"schema S { async async\nid: Missing }",
		"schema S = { async async }",
		"schema S = { async\nid: string };",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				result, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("control became an admission gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	for key, source := range map[string]string{
		"admission:schema-duplicate-readonly": "schema S = readonly { readonly readonly id : Missing } ;",
	} {
		t.Run(key, func(t *testing.T) { checkGrammarAdmission(t, w, key, source) })
	}
}
