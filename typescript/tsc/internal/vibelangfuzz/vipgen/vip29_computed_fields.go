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
			Reading:  "Chapter 3's Field keys example uses a literal-typed field name, const field = \"actual\", whose key domain excludes _tag as VIP-29's computed-key amendment requires, and Schema.decodeUnknownExit: a missing actual key fails, and an unrelated key is stripped. The reference keeps that exact Schema.TaggedError class and computed field map. Type-only arguments/annotations are erased for ref.mjs.",
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
	w.Write(fmt.Sprintf("const %s = \"actual\";\nschema error %s { [%s]: number }", d.Key, d.Name, d.Key))
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

// Keep the declaration inside the generated Effect body: its field codecs
// are evaluated as part of the generated class's extends expression.
func init() {
	Register(&Construct{
		Key: "vip29.schema-error-effect-key", VIP: 29,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip15.schema"},
		Citations: []Citation{{
			VIP:      29,
			Template: "class ‹Name› extends Schema.TaggedError‹<Name>›()(‹tag›, { value: Schema.Struct({ [yield* ‹key›]: Schema.String }) }) {}",
			Quote:    "`schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas. Transport compatibility follows their encoded representations, as above.",
			Reading:  "Chapter 2 evaluates computed class keys and extends clauses in the enclosing Effect. VIP-29 maps nested fields with VIP-15. The reference yields the key inside the Schema.TaggedError base expression. A key event checks exactly-once evaluation and ordering, and Schema.is checks the resulting string, number or symbol field inside struct, optional, array and tuple payloads.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{schemaErrorEffectKeyProbe(g)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return schemaErrorEffectKeyProbe(g) },
	})
}

type schemaErrorEffectKey struct {
	Name, Key, Symbol, Label string
	Shape, Kind              int
	Inline                   bool
}

func schemaErrorEffectKeyProbe(g *Gen) Stmt {
	g.UseEffect()
	g.UseModule("Schema", false)
	return &schemaErrorEffectKey{
		Name: g.Name("KeyError"), Key: g.Name("keyEffect"), Symbol: g.Name("field"),
		Label: g.Label(), Shape: g.Intn(4), Kind: g.Intn(3), Inline: g.Chance(2),
	}
}

func (p *schemaErrorEffectKey) Vibe(w *Writer)   { p.write(w, true) }
func (p *schemaErrorEffectKey) Effect(w *Writer) { p.write(w, false) }
func (*schemaErrorEffectKey) Ends() bool         { return false }

func (p *schemaErrorEffectKey) write(w *Writer, vibe bool) {
	w.Write("{\n")
	key := []string{fmt.Sprintf("%q", "key"), "7", p.Symbol}[p.Kind]
	if p.Kind == 2 {
		annotation := ""
		if vibe {
			annotation = ": unique symbol"
		}
		w.Write(fmt.Sprintf("const %s%s = Symbol();\n", p.Symbol, annotation))
	}
	keyEffect := fmt.Sprintf("Effect.sync(() => { ev(%q); return %s; })", p.Label, key)
	if !p.Inline {
		w.Write(fmt.Sprintf("const %s = %s;\n", p.Key, keyEffect))
		keyEffect = p.Key
	}
	run := "yield* "
	if vibe {
		run = "try "
	}
	field := fmt.Sprintf("{ readonly [%s%s]: string }", run, keyEffect)
	codec := fmt.Sprintf("Schema.Struct({ [%s%s]: Schema.String })", run, keyEffect)
	value := fmt.Sprintf("{ [%s]: \"kept\" }", key)
	optional := ""
	switch p.Shape {
	case 1:
		optional = "?"
		codec = "Schema.optional(" + codec + ")"
	case 2:
		field = "Array<" + field + ">"
		codec = "Schema.mutable(Schema.Array(" + codec + "))"
		value = "[" + value + "]"
	case 3:
		field = "[" + field + "]"
		codec = "Schema.mutable(Schema.Tuple([" + codec + "]))"
		value = "[" + value + "]"
	}
	if vibe {
		w.Write(fmt.Sprintf("schema error %s { value%s: %s }\n", p.Name, optional, field))
	} else {
		w.Write(fmt.Sprintf("class %s extends Schema.TaggedError()(%q, { value: %s }) {}\n", p.Name, p.Name, codec))
	}
	w.Write(fmt.Sprintf("ev(%sEffect.sync(() => Schema.is(%s)(new %s({ value: %s })) ? \"valid\" : \"invalid\"));\n}", run, p.Name, p.Name, value))
}
