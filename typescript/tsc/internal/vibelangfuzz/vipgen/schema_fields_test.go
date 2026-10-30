package vipgen

import "testing"

// A decoded failure includes the codec AST, so the SDK oracle must retain
// writable key contexts as well as matching successful decoded values.
func TestSchemaFieldMutabilityContexts(t *testing.T) {
	fields := []*SchemaField{{Name: "required", Kind: fieldString}, {Name: "optional", Kind: fieldNumber, Optional: true}}
	normal := &SchemaDecl{Name: "S", Fields: fields}
	failure := &SchemaErrorDecl{Name: "E", Fields: fields}
	render := func(n Node, mode mode) string {
		w := &Writer{mode: mode}
		w.Node(n)
		return w.b.String()
	}
	want := "const S = Schema.Struct({ required: Schema.mutableKey(Schema.String), optional: Schema.mutableKey(Schema.optional(Schema.Number)) })"
	if got := render(normal, modeEffect); got != want {
		t.Fatalf("normal schema:\n%s\nwant:\n%s", got, want)
	}
	wantError := "class E extends Schema.TaggedError()(\"E\", { required: Schema.String, optional: Schema.optional(Schema.Number) }) {}"
	if got := render(failure, modeEffect); got != wantError {
		t.Fatalf("schema-error fields lost their readonly defaults:\n%s", got)
	}
	if got := render(normal, modeEffect); got != want {
		t.Fatalf("rendering a schema error mutated shared fields:\n%s", got)
	}
	if got := render(normal, modeVibe); got != "schema S { required: string; optional?: number }" {
		t.Fatalf("changed source fields:\n%s", got)
	}
}
