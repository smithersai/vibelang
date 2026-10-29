package vipgen

import "fmt"

// VIP-29: serializable errors. "`schema error Name { fields }` combines
// VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as
// TypeScript types and mapped to Schemas, and the error can be decoded from
// JSON". The reference is the class VIP-29 shows, less its type argument
// `<NotFound>`, which ref.mjs, untyped JavaScript, cannot hold:
//
//	schema error E0 { f0: number; f1: string }
//	class E0 extends Schema.TaggedError()("E0", { f0: Schema.Number, f1: Schema.String }) {}
//
// The fields are VIP-15's (vip15_schema.go). A program uses the error as
// VIP-13 uses its errors: thrown (VIP-4) and caught with
// `x catch (e) => f(e)` (VIP-5's table). VIP-29 shows no Effect TS for
// crossing JSON, so the suite reads "can be decoded from JSON" as Effect's
// Schema.encodeEffect of an error, then Schema.decodeUnknownEffect of what
// it encoded, which gives an equal error; a decode of a corrupted encoding
// fails with a SchemaError, whose structure the Exit comparison checks.
// The encoding is a plain object, so it is what JSON would carry.
//
// A schema error may have no fields. VIP-29's error is VIP-13's, and VIP-13
// shows one, "error Timeout // an error with no fields", read as
// `class Timeout extends Data.TaggedError("Timeout") {}`.
// Chapter 3's grammar keeps the braces of a schema error and lets its
// fields be empty ("SchemaErrorDeclaration = … "schema" "error" Name "{"
// SchemaFields (Method | Getter)* "}"", and Chapter 6's SchemaFields is a
// list of zero or more), and VIP-29's "`schema error NotFound {`" tells the
// declaration from an alias by the brace, so the zero-field form is
//
//	schema error E0 {}
//	class E0 extends Schema.TaggedError()("E0", {}) {}
//
// Effect's Schema.TaggedError takes its fields as a required argument, and
// `{}` is an empty field set; its class's constructor takes no props when
// the field set is empty, so such an error is `new E0()`, as VIP-13's
// generator writes its field-less errors. A catch reads a number field only
// where the error has one, and a corruption of a field-less encoding
// replaces its _tag.

func init() {
	Register(&Construct{
		Key:      "vip29.schema-error",
		VIP:      29,
		Requires: []string{"vip01.effect-function", "vip04.throw", "vip05.catch-function", "vip05.try", "vip15.schema"},
		Citations: []Citation{
			{
				VIP:      29,
				Template: `class ‹Name› extends Schema.TaggedError‹<Name>›()(‹"Name"›, { ‹field›: Schema.String }) {}`,
				Quote:    "`schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas, and the error can be decoded from JSON, so it crosses workers and RPC.",
			},
			{
				VIP:      13,
				Template: "new ‹Name›({ ‹fields› })",
				Quote:    "throw new NotFound({ id })                      // in an effect function: fails with NotFound",
			},
			{
				VIP:      29,
				Template: "yield* Schema.encodeEffect(‹Name›)(‹error›)",
				Quote:    "the error can be decoded from JSON, so it crosses workers and RPC.",
				Reading:  "VIP-29 shows no Effect TS for crossing JSON. The class is a Schema, so the suite encodes the error with Effect's Schema.encodeEffect, run with try (yield*), which gives the plain object JSON carries.",
			},
			{
				VIP:      29,
				Template: "yield* Schema.decodeUnknownEffect(‹Name›)(‹encoded›)",
				Quote:    "the error can be decoded from JSON, so it crosses workers and RPC.",
				Reading:  "VIP-29 shows no Effect TS for decoding. The suite decodes the encoded object, or a corrupted one, with Effect's Schema.decodeUnknownEffect, run with try (yield*): an equal error, or a SchemaError.",
			},
		},
		// The probe declares `schema error E0 { f0: number; f1: string }`,
		// catches a failure with one and reads its number, encodes an E0
		// and decodes it again, logs the decoded error's _tag, and throws
		// the decoded error, so main fails with an E0 that crossed JSON. A
		// campaign's input leaves the throw out half the time.
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			d := &SchemaErrorDecl{Name: schemaErrorName(g), Fields: []*SchemaField{{Name: "f0", Kind: fieldNumber}, {Name: "f1", Kind: fieldString}}}
			g.UseModule("Schema", true)
			g.AddDecl(d)
			v, e := g.Name("v"), g.Name("e")
			g.Use("vip05.catch-function")
			fail := &EffectCall{Fn: "fail", Arg: &NewSchemaError{Decl: d, Values: []Expr{&Num{Value: 1}, &Str{Value: "s0"}}}}
			caught := &Const{Name: v, Value: &CatchFn{X: fail, Param: e, Body: &Field{X: &Ref{Name: e}, Name: "f0"}}}
			s.Locals = append(s.Locals, v)
			trip, decoded := roundTrip(g, d, &NewSchemaError{Decl: d, Values: []Expr{&Add{A: &Ref{Name: v}, B: &Num{Value: 1}}, &Str{Value: "s1"}}}, nil)
			body := []Stmt{caught}
			body = append(body, trip...)
			body = append(body, &TagEvent{X: &Ref{Name: decoded}})
			// A campaign's input leaves the throw out half the time, so the
			// statements it writes after the focus run.
			if g.Chance(2) {
				return body
			}
			return append(body, &Throw{Value: &Ref{Name: decoded}})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			d := pickSchemaError(g)
			switch g.Intn(4) {
			case 1:
				// Caught: the handler reads the error's number, or a number.
				g.UseEffect()
				g.Use("vip05.catch-function")
				v, e := g.Name("v"), g.Name("e")
				body := g.Num(s)
				if f := d.numberField(); f != nil && g.Chance(2) {
					body = &Field{X: &Ref{Name: e}, Name: f.Name}
				}
				fail := &EffectCall{Fn: "fail", Arg: newSchemaError(g, s, d)}
				st := &Const{Name: v, Value: &CatchFn{X: fail, Param: e, Body: body}}
				s.Locals = append(s.Locals, v)
				return st
			case 2, 3:
				// Encoded and decoded again, or decoded from a corrupted
				// encoding; then read, or thrown.
				var corrupt *Entry
				if g.Chance(3) {
					corrupt = corruption(g, s, d)
				}
				trip, decoded := roundTrip(g, d, newSchemaError(g, s, d), corrupt)
				var read Stmt = &TagEvent{X: &Ref{Name: decoded}}
				switch f := d.numberField(); {
				case g.Chance(3):
					read = &Throw{Value: &Ref{Name: decoded}}
				case f != nil:
					v := g.Name("v")
					s.Locals = append(s.Locals, v)
					read = &Const{Name: v, Value: &Field{X: &Ref{Name: decoded}, Name: f.Name}}
				}
				return &Seq{Stmts: append(trip, read)}
			}
			return &If{Cond: g.Cond(s), Then: []Stmt{&Throw{Value: newSchemaError(g, s, d)}}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			// Effect.fail never succeeds, so it suits a number operand too.
			g.UseEffect()
			return &EffectCall{Fn: "fail", Arg: newSchemaError(g, s, pickSchemaError(g))}
		},
	})
}

// A SchemaErrorDecl is `schema error E0 { f0: number }`, read as
// `class E0 extends Schema.TaggedError()("E0", { f0: Schema.Number }) {}`.
type SchemaErrorDecl struct {
	Name   string
	Fields []*SchemaField
}

func (d *SchemaErrorDecl) Vibe(w *Writer) {
	w.Write("schema error " + d.Name + " ")
	schemaFields(w, d.Fields, "; ")
}

func (d *SchemaErrorDecl) Effect(w *Writer) {
	w.Write(fmt.Sprintf("class %s extends Schema.TaggedError()(%q, ", d.Name, d.Name))
	schemaFields(w, d.Fields, ", ")
	w.Write(") {}")
}

// numberField returns the error's first required number field, or nil.
func (d *SchemaErrorDecl) numberField() *SchemaField {
	return (&SchemaDecl{Fields: d.Fields}).numberField()
}

// A NewSchemaError is `new E0({ f0: <v0>, f1: <v1> })`, in both prints: one
// value per field, nil for an optional field left out. An error with no
// fields is `new E0()`.
type NewSchemaError struct {
	Decl   *SchemaErrorDecl
	Values []Expr
}

func (n *NewSchemaError) Vibe(w *Writer) {
	if len(n.Decl.Fields) == 0 {
		w.Write("new " + n.Decl.Name + "()")
		return
	}
	o := &ObjectLit{}
	for i, f := range n.Decl.Fields {
		if n.Values[i] != nil {
			o.Entries = append(o.Entries, Entry{f.Name, n.Values[i]})
		}
	}
	w.Write("new " + n.Decl.Name + "(")
	w.Node(o)
	w.Write(")")
}
func (n *NewSchemaError) Effect(w *Writer) { n.Vibe(w) }

// A Spread is { ...<X>, <Key>: <Value> }, in both prints: an encoding with
// one field replaced.
type Spread struct {
	X     Expr
	Entry Entry
}

func (p *Spread) Vibe(w *Writer) {
	w.Write("{ ...")
	w.Node(p.X)
	w.Write(", " + p.Entry.Key + ": ")
	w.Node(p.Entry.Value)
	w.Write(" }")
}
func (p *Spread) Effect(w *Writer) { p.Vibe(w) }

// schemaErrorDecls returns the program's schema error declarations so far.
func schemaErrorDecls(g *Gen) []*SchemaErrorDecl {
	var out []*SchemaErrorDecl
	for _, d := range g.Decls() {
		if e, ok := d.(*SchemaErrorDecl); ok {
			out = append(out, e)
		}
	}
	return out
}

// schemaErrorName names the program's next schema error: E0, E1.
func schemaErrorName(g *Gen) string {
	return fmt.Sprintf("E%d", len(schemaErrorDecls(g)))
}

// pickSchemaError returns one of the program's schema errors, declaring a
// new one, up to two, now and then. One error in five it declares has no
// fields (VIP-13's `error Timeout`).
func pickSchemaError(g *Gen) *SchemaErrorDecl {
	have := schemaErrorDecls(g)
	if len(have) == 0 || len(have) < 2 && g.Chance(3) {
		d := &SchemaErrorDecl{}
		if !g.Chance(5) {
			d.Fields = newSchemaFields(g)
		}
		d.Name = schemaErrorName(g)
		g.UseModule("Schema", true)
		g.AddDecl(d)
		return d
	}
	return have[g.Intn(len(have))]
}

// newSchemaError writes `new E0({ … })` with a valid value for each field:
// the constructor validates its fields, and VibeLang's types reject an
// invalid one, so a program never builds one. An optional field is left
// out now and then.
func newSchemaError(g *Gen, s *Scope, d *SchemaErrorDecl) *NewSchemaError {
	n := &NewSchemaError{Decl: d}
	for _, f := range d.Fields {
		if f.Optional && g.Chance(2) {
			n.Values = append(n.Values, nil)
			continue
		}
		var x Expr
		if f.Kind == fieldRef {
			x = validValue(g, s, f.Ref)
		} else {
			x = fieldValue(g, s, f, maxDepth)
		}
		n.Values = append(n.Values, x)
	}
	return n
}

// corruption replaces one field of an encoding with a value of the wrong
// type, or its _tag with another error's. An error with no fields has only
// its _tag to corrupt.
func corruption(g *Gen, s *Scope, d *SchemaErrorDecl) *Entry {
	i := g.Intn(len(d.Fields) + 1)
	if i == len(d.Fields) {
		return &Entry{"_tag", &Str{Value: "Other"}}
	}
	return &Entry{d.Fields[i].Name, wrongValue(g, s, d.Fields[i])}
}

// roundTrip writes
//
//	const j0 = try Schema.encodeEffect(E0)(<err>)
//	const d1 = try Schema.decodeUnknownEffect(E0)(j0)
//
// or, with corrupt set, decodes `{ ...j0, <field>: <wrong> }`, which fails
// with a SchemaError. It returns the statements and the decoded error's
// name.
func roundTrip(g *Gen, d *SchemaErrorDecl, err *NewSchemaError, corrupt *Entry) ([]Stmt, string) {
	g.UseModule("Schema", true)
	j, decoded := g.Name("j"), g.Name("d")
	encode := &Apply{F: &ModCall{Mod: "Schema", Fn: "encodeEffect", Args: []Expr{&Ref{Name: d.Name}}}, Args: []Expr{err}}
	var input Expr = &Ref{Name: j}
	if corrupt != nil {
		input = &Spread{X: input, Entry: *corrupt}
	}
	decode := &Apply{F: &ModCall{Mod: "Schema", Fn: "decodeUnknownEffect", Args: []Expr{&Ref{Name: d.Name}}}, Args: []Expr{input}}
	return []Stmt{
		&Const{Name: j, Value: &Try{X: encode}},
		&Const{Name: decoded, Value: &Try{X: decode}},
	}, decoded
}
