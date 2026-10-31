package vipgen

import "fmt"

// Detail 111 applies VIP-15's field mapping to noncomputed __proto__
// names: a type property is an own field, never a prototype setter.
// Log tags, booleans and the field's string through the suite's ordinary
// event log; the worker need not interpret a source-keyed dictionary.
func init() {
	Register(&Construct{
		Key: "vip15.schema-proto-field", VIP: 15,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      15,
			Template: "const ‹Name› = Schema.Struct({ [\"__proto__\"]: Schema.String })",
			Quote:    "`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.",
			Reading:  "Decided detail 111 reconciles VIP-15's per-field mapping with TypeScript object-type property meaning: identifier, quoted and escaped __proto__ fields, including nested structs, become own computed keys in the fields object. Decode valid, missing and wrong-type inputs with Schema.decodeUnknownExit; compare its tags and the decoded own field.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{protoFieldProbe(g, false)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return protoFieldProbe(g, false) },
	})
}

func protoFieldProbe(g *Gen, schemaError bool) Stmt {
	g.UseEffect()
	g.UseModule("Schema", false)
	spellings := []string{"__proto__", `"__proto__"`, `"__pro\u0074o__"`, `__pro\u0074o__`}
	d := &protoFieldSchema{
		Name: g.Name("Proto"), Spelling: spellings[g.Intn(len(spellings))],
		Nested: g.Chance(2), Error: schemaError,
	}
	g.AddDecl(d)
	return &protoFieldDecode{Decl: d, Prefix: g.Name("proto")}
}

type protoFieldSchema struct {
	Name, Spelling string
	Nested, Error  bool
}

func (d *protoFieldSchema) Vibe(w *Writer) {
	form := "schema "
	if d.Error {
		form = "schema error "
	}
	field := d.Spelling + ": string"
	if d.Nested {
		field = "value: { readonly " + field + " }"
	}
	w.Write(form + d.Name + " { readonly " + field + " }")
}

func (d *protoFieldSchema) Effect(w *Writer) {
	field := `["__proto__"]: Schema.String`
	if d.Nested {
		field = "value: Schema.Struct({ " + field + " })"
	}
	if d.Error {
		w.Write(fmt.Sprintf("class %s extends Schema.TaggedError()(%q, { %s }) {}", d.Name, d.Name, field))
	} else {
		w.Write("const " + d.Name + " = Schema.Struct({ " + field + " })")
	}
}

type protoFieldDecode struct {
	Decl   *protoFieldSchema
	Prefix string
}

func (p *protoFieldDecode) Vibe(w *Writer) {
	w.Write("ev(try Effect.sync((): string => {\n")
	p.observations(w)
	w.Write("\n}))")
}
func (p *protoFieldDecode) Effect(w *Writer) {
	// The harness writes ref.mjs: erase the Vibe callback annotation and Self type.
	w.Write("ev(yield* Effect.sync(() => {\n")
	p.observations(w)
	w.Write("\n}))")
}
func (p *protoFieldDecode) observations(w *Writer) {
	d, n := p.Decl, p.Prefix
	input := func(value string) string {
		if d.Nested {
			value = "{ value: " + value + " }"
		}
		if d.Error {
			value = fmt.Sprintf("{ _tag: %q, ...%s }", d.Name, value)
		}
		return value
	}
	valid := input(`{ ["__proto__"]: "kept" }`)
	w.Write(fmt.Sprintf("const %sDecode = Schema.decodeUnknownExit(%s);\n", n, d.Name))
	w.Write(fmt.Sprintf("const %sValid = %sDecode(%s);\n", n, n, valid))
	w.Write(fmt.Sprintf("const %sMissing = %sDecode(%s);\n", n, n, input("{}")))
	w.Write(fmt.Sprintf("const %sWrong = %sDecode(%s);\n", n, n, input(`{ ["__proto__"]: 42 }`)))
	field := n + "Valid.value"
	if d.Nested {
		field += ".value"
	}
	w.Write(fmt.Sprintf("const %sField = %sValid._tag === \"Success\" ? %s : undefined;\n", n, n, field))
	values := fmt.Sprintf("%sMissing._tag, %sWrong._tag, %sValid._tag, %sField !== undefined && Object.hasOwn(%sField, \"__proto__\"), %sField === undefined ? null : %sField[\"__proto__\"]", n, n, n, n, n, n, n)
	if d.Error {
		// The constructor receives data with an own key too. Prototype-setting
		// source object syntax would not supply the required field.
		props := `{ ["__proto__"]: "kept" }`
		if d.Nested {
			props = "{ value: " + props + " }"
		}
		w.Write(fmt.Sprintf("const %sInstance = new %s(%s);\n", n, d.Name, props))
		instance := n + "Instance"
		if d.Nested {
			instance += ".value"
		}
		values += fmt.Sprintf(", Object.hasOwn(%s, \"__proto__\"), %s[\"__proto__\"]", instance, instance)
	}
	w.Write("return JSON.stringify([" + values + "])")
}
func (*protoFieldDecode) Ends() bool { return false }
