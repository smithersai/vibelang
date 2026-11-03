package vipgen

import (
	"fmt"
	"strings"
)

const schemaOptionalKey = "vip15.optional-fields-plain"

func init() {
	Register(&Construct{
		Key: schemaOptionalKey, VIP: 15, Plain: true,
		Citations: []Citation{{
			VIP: 15, Template: "Schema.optional(‹schema›)",
			Quote:   "`name?: T` means `Schema.optional`, which accepts a missing key or `undefined`, matching TypeScript's default.",
			Reading: "VIP-15 ties optional fields to TypeScript. The 2026-11-03 ruling applies the project's exactOptionalPropertyTypes setting to fields and tuple positions; native Data payloads retain TypeScript's own optional properties. Both printers share source choices; the reference writes Effect codecs independently.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{newOptionalSchemas(g)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return newOptionalSchemas(g) },
	})
}

func newOptionalSchemas(g *Gen) Stmt {
	g.UseModule("Schema", true)
	d := &optionalSchemas{Name: g.Name("Optional"), Mode: uint8(g.Intn(32))}
	g.AddDecl(d)
	return &optionalSchemaDecode{d}
}

type optionalSchemas struct {
	Name          string
	Mode          uint8
	Exact, Export bool
}

func (d *optionalSchemas) parts() (typ, codec, valid string) {
	switch d.Mode % 3 {
	case 1:
		return "number", "Schema.Number", "12"
	case 2:
		return "boolean", "Schema.Boolean", "true"
	default:
		return "string", "Schema.String", `"ok"`
	}
}
func (d *optionalSchemas) field() (typ, codec, valid string) {
	typ, codec, valid = d.parts()
	if d.Mode&4 != 0 {
		typ += " | undefined"
		codec = "Schema.Union([" + codec + ", Schema.Undefined])"
	}
	op := "optional"
	if d.Exact && d.Mode&4 == 0 {
		op = "optionalKey"
	}
	codec = "Schema." + op + "(" + codec + ")"
	return
}
func (d *optionalSchemas) prefix() string {
	if d.Export {
		return "export "
	}
	return ""
}
func (d *optionalSchemas) Vibe(w *Writer) {
	typ, _, _ := d.field()
	ro := "mutable "
	if d.Mode&16 != 0 {
		ro = "readonly "
	}
	field := ro + "value?: " + typ
	dataField := "value?: " + typ
	if d.Mode&8 != 0 {
		field = ro + "box?: { " + field + " }"
		dataField = "box?: { readonly " + dataField + " }"
	}
	p, n := d.prefix(), d.Name
	w.Line(p + "schema " + n + "Struct { " + field + " }")
	w.Line(p + "schema error " + n + "Error { " + strings.TrimPrefix(strings.TrimPrefix(field, "readonly "), "mutable ") + " }")
	tuple := "[(" + typ + ")?]"
	if d.Mode&2 != 0 {
		tuple = "[value?: " + typ + "]"
	}
	if d.Mode&16 != 0 {
		tuple = "readonly " + tuple
	}
	w.Line(p + "schema " + n + "Tuple = " + tuple)
	w.Line(p + "data " + n + "Data { Ready { " + dataField + " } }")
}
func (d *optionalSchemas) printEffect(w *Writer, typed bool) {
	_, codec, _ := d.field()
	field := codec
	if d.Mode&16 == 0 {
		field = "Schema.mutableKey(" + field + ")"
	}
	errorField := codec
	if d.Mode&8 != 0 {
		inner := "Schema.Struct({ value: " + field + " })"
		op := "optional"
		if d.Exact {
			op = "optionalKey"
		}
		field = "Schema." + op + "(" + inner + ")"
		errorField = field
		if d.Mode&16 == 0 {
			field = "Schema.mutableKey(" + field + ")"
		}
	}
	key := "value"
	if d.Mode&8 != 0 {
		key = "box"
	}
	tuple := "Schema.Tuple([" + codec + "])"
	if d.Mode&16 == 0 {
		tuple = "Schema.mutable(" + tuple + ")"
	}
	p, n := d.prefix(), d.Name
	w.Line(p + "const " + n + "Struct = Schema.Struct({ " + key + ": " + field + " })")
	if typed {
		w.Line(p + "type " + n + "Struct = typeof " + n + "Struct.Type")
	}
	self := ""
	if typed {
		self = "<" + n + "Error>"
	}
	w.Line(p + "class " + n + "Error extends Schema.TaggedError" + self + "()(" + fmt.Sprintf("%q", n+"Error") + ", { " + key + ": " + errorField + " }) {}")
	w.Line(p + "const " + n + "Tuple = " + tuple)
	if typed {
		w.Line(p + "type " + n + "Tuple = typeof " + n + "Tuple.Type")
	}
	if typed {
		typ, _, _ := d.field()
		payload := "value?: " + typ
		if d.Mode&8 != 0 {
			payload = "box?: { readonly " + payload + " }"
		}
		w.Line(p + "type " + n + "Data = Data.TaggedEnum<{ Ready: { " + payload + " } }>")
		w.Line(p + "const " + n + "Data = Data.taggedEnum<" + n + "Data>()")
	} else {
		w.Line(p + "const " + n + "Data = Data.taggedEnum()")
	}
}
func (d *optionalSchemas) Effect(w *Writer) { d.printEffect(w, false) }

type optionalSchemaDecode struct{ *optionalSchemas }

func (d *optionalSchemaDecode) Vibe(w *Writer)   { d.print(w) }
func (d *optionalSchemaDecode) Effect(w *Writer) { d.print(w) }
func (*optionalSchemaDecode) Ends() bool         { return false }
func (d *optionalSchemaDecode) print(w *Writer) {
	_, _, valid := d.field()
	objects := []string{"{}", "{ value: undefined }", "{ value: " + valid + " }", `{ value: null }`}
	if d.Mode&8 != 0 {
		objects = []string{"{}", "{ box: undefined }", "{ box: {} }", "{ box: { value: undefined } }", "{ box: { value: " + valid + " } }"}
	}
	values := []string{}
	for _, form := range []string{"Struct", "Error"} {
		for _, obj := range objects {
			if form == "Error" {
				obj = "{ _tag: " + fmt.Sprintf("%q", d.Name+"Error") + ", ..." + obj + " }"
			}
			values = append(values, "JSON.stringify(Schema.decodeUnknownExit("+d.Name+form+")("+obj+"), (_key, value) => value === undefined ? \"$undefined\" : value)")
		}
	}
	for _, array := range []string{"[]", "[undefined]", "[" + valid + "]", "[null]"} {
		values = append(values, "JSON.stringify(Schema.decodeUnknownExit("+d.Name+"Tuple)("+array+"), (_key, value) => value === undefined ? \"$undefined\" : value)")
	}
	values = append(values, d.Name+"Data.Ready({})._tag")
	w.Write("ev(JSON.stringify([" + strings.Join(values, ", ") + "]))")
}

// These probes use FuzzVIPDifferential's generator, Node worker and comparison.
// A supplied tsconfig is a normal project file; no shared fuzz-core change is
// needed to test the same optional node under both project settings.
func SchemaOptionalProgram(mode uint8, exact bool) *Program {
	p := Probe(schemaOptionalKey)
	for _, node := range p.Decls {
		if d, ok := node.(*optionalSchemas); ok {
			d.Mode = mode % 32
			d.Exact = exact
		}
	}
	p.Files["tsconfig.json"] = SchemaOptionalConfig(exact)
	return p
}
func SchemaOptionalConfig(exact bool) string {
	return fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","lib":["esnext","dom"],"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"exactOptionalPropertyTypes":%t,"declaration":true,"outDir":"out"},"files":["main.vibe"]}`, exact)
}
func SchemaOptionalSources(mode uint8, exact bool) (string, string) {
	d := &optionalSchemas{Name: "Optional", Mode: mode % 32, Exact: exact, Export: true}
	v, t := &Writer{}, &Writer{}
	d.Vibe(v)
	t.Line(`import { Data, Schema } from "effect"`)
	d.printEffect(t, true)
	return v.String(), t.String()
}
