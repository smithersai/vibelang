package vibelangfuzz

import (
	"fmt"
	"testing"
)

const errorShallowReadonlyQuote = "`error Name { fields }` declares exactly Effect\u0027s `Data.TaggedError` class. The tag is always the name, and every field is readonly."
const schemaErrorNestedMutableQuote = "Nested mutable values remain mutable."

// These are static assignability oracles, not another runtime differential
// generator. Only payload keys gain readonly; native nested types keep theirs.
func TestErrorShallowReadonlyQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", errorShallowReadonlyQuote, schemaErrorNestedMutableQuote)
}

type errorShallowReadonlyRow struct {
	key, fields, body string
	readonly          bool
}

var errorShallowReadonlyRows = []errorShallowReadonlyRow{
	{"nested-object", "value: { count: number }", "e.value.count = 2", false},
	{"deep-object", "value: { inner: { count: number } }", "e.value.inner.count = 2", false},
	{"array-object", "value: { count: number }[]", "e.value[0]!.count = 2", false},
	{"tuple-object", "value: [{ count: number }]", "e.value[0].count = 2", false},
	{"optional-object", "value?: { count: number }", "if (e.value) e.value.count = 2", false},
	{"method-parameter", "value: number; change(p: { count: number }): void { p.count = 2 }", "e.change({ count: 1 })", false},
	{"method-return", "value: number; make(): { count: number } { return { count: 1 } }", "e.make().count = 2", false},
	{"method-local-type", "value: number; change(): void { const p: { count: number } = { count: 1 }; p.count = 2 }", "e.change()", false},
	{"outer-readonly", "value: { count: number }", "e.value = { count: 2 }", true},
	{"explicit-nested-readonly", "value: { readonly count: number }", "e.value.count = 2", true},
	{"array-element", "value: number[]", "e.value[0] = 2", false},
	{"named-reference", "value: Payload", "e.value.count = 2", false},
}

func errorShallowReadonlyNames() []string {
	var names []string
	for _, kind := range []string{"error", "schema-error"} {
		for _, row := range errorShallowReadonlyRows {
			names = append(names, kind+"/"+row.key)
		}
	}
	return names
}

func FuzzErrorShallowReadonly(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", errorShallowReadonlyQuote, schemaErrorNestedMutableQuote)
	names := errorShallowReadonlyNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzErrorShallowReadonly"
		i := r4Pick(data, names)
		row := errorShallowReadonlyRows[i%len(errorShallowReadonlyRows)]
		kind := "error"
		if i >= len(errorShallowReadonlyRows) {
			kind = "schema error"
		}
		prelude := "type Payload = { count: number }"
		if kind == "schema error" && row.key == "named-reference" {
			prelude = "const Payload = Schema.Struct({ count: Schema.mutableKey(Schema.Number) })"
		}
		source := fmt.Sprintf("%s\n%s Failure { %s }\nexport function change(e: Failure): void { %s }\n", prelude, kind, row.fields, row.body)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		// Do not hide unrelated parser/type failures under a known readonly gap.
		for _, code := range errors {
			if code != "TS2540" {
				t.Fatalf("%s: independent diagnostic %s (%v)\n%s", names[i], code, errors, source)
			}
		}
		key := "admission:" + names[i]
		if row.readonly {
			if len(errors) != 1 {
				Gap(t, target, key, "003: %s; a readonly write needs exactly one TS2540, got %v\n%s", errorShallowReadonlyQuote, errors, source)
			}
		} else if len(errors) != 0 {
			Gap(t, target, key, "003: %s %s; nested native mutable types must admit the write; got %v\n%s", errorShallowReadonlyQuote, schemaErrorNestedMutableQuote, errors, source)
		}
		ExpectPending(t, target, key)
		if corpus := corpusFile(t, target); corpus != "" {
			ExpectPending(t, target, "corpus:"+corpus)
		}
	})
}

func TestErrorShallowReadonlyKeys(t *testing.T) {
	names := errorShallowReadonlyNames()
	for i, key := range names {
		if got := r4Pick([]byte("key:"+key), names); got != i {
			t.Fatalf("key %s changed meaning: %d != %d", key, got, i)
		}
	}
	// The byte fallback remains useful for mutations without a complete key.
	if got := r4Pick([]byte{255}, names); got != 255%len(names) {
		t.Fatal(got)
	}
}
