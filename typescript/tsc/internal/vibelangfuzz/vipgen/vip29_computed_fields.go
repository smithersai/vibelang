package vipgen

import "fmt"

// Chapter 3's dynamic-key example keeps one runtime key. An index
// signature in the instance type does not validate arbitrary object keys.
func init() {
	Register(&Construct{
		Key:   "vip29.computed-fields-plain",
		VIP:   29,
		Plain: true,
		Citations: []Citation{{
			VIP:      29,
			Template: "class ‹Name› extends Schema.TaggedError‹<Name>›()(‹tag›, { [‹field›]: Schema.Number }) {}",
			Quote:    "`schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas. Transport compatibility follows their encoded representations, as above.",
			Reading:  "Chapter 3's Field keys example uses a string-typed field name and Schema.decodeUnknownExit: a missing actual key fails, and an unrelated key is stripped. The reference keeps that exact Schema.TaggedError class and computed field map. Type-only arguments/annotations are erased for ref.mjs.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			return []Stmt{&Event{Label: g.Label()}, computedErrorProbe(g)}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return computedErrorProbe(g) },
	})
}

func computedErrorProbe(g *Gen) Stmt {
	g.UseEffect()
	g.UseModule("Schema", false)
	name, key := g.Name("Dynamic"), g.Name("field")
	g.AddDecl(&computedSchemaError{Name: name, Key: key})
	return &computedErrorDecode{Name: name, Decode: g.Name("decode"), Missing: g.Name("missing"), Full: g.Name("full")}
}

type computedSchemaError struct{ Name, Key string }

func (d *computedSchemaError) Vibe(w *Writer) {
	w.Write(fmt.Sprintf("const %s: string = \"actual\";\nschema error %s { [%s]: number }", d.Key, d.Name, d.Key))
}
func (d *computedSchemaError) Effect(w *Writer) {
	w.Write(fmt.Sprintf("const %s = \"actual\";\nclass %s extends Schema.TaggedError()(%q, { [%s]: Schema.Number }) {}", d.Key, d.Name, d.Name, d.Key))
}

type computedErrorDecode struct{ Name, Decode, Missing, Full string }

func (p *computedErrorDecode) Vibe(w *Writer) { p.Effect(w) }
func (p *computedErrorDecode) Effect(w *Writer) {
	w.Write(fmt.Sprintf("const %s = Schema.decodeUnknownExit(%s);\n", p.Decode, p.Name))
	w.Write(fmt.Sprintf("const %s = %s({ _tag: %q, other: 1 });\n", p.Missing, p.Decode, p.Name))
	w.Write(fmt.Sprintf("const %s = %s({ _tag: %q, actual: 1, other: 2 });\n", p.Full, p.Decode, p.Name))
	w.Write(fmt.Sprintf("return Effect.succeed([%s._tag, %s._tag === \"Success\" ? [%s.value.actual, \"other\" in %s.value] : [\"unexpected-failure\"]])", p.Missing, p.Full, p.Full, p.Full))
}
func (*computedErrorDecode) Ends() bool { return true }
