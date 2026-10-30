package vipgen

import (
	"fmt"
	"strconv"
	"strings"
)

// VIP-15: `schema` declarations. "`schema Name { fields }` and `schema Name =
// type` declare a Schema constant and its type under one name." The
// reference is VIP-15's Effect TS less its `type Name = typeof Name.Type`
// line, which ref.mjs, untyped JavaScript, cannot hold and which changes
// nothing that runs:
//
//	schema S0 { f0: number; f1?: string; f2: K0 }
//	const S0 = Schema.Struct({ f0: Schema.Number, f1: Schema.optional(Schema.String), f2: K0 })
//	schema K0 = "k0" | "k1"
//	const K0 = Schema.Literals(["k0", "k1"])
//
// The fields are the forms VIP-15 shows in code: string, a literal union,
// an optional field, another schema's name, and number, whose Schema.Number
// VIP-14 shows. VIP-15 lists arrays, tuples, Record and nested object types
// in prose only, with no Effect TS, so the generator does not write them.
//
// VIP-15 names no decoding function. The suite decodes with Effect's
// Schema.decodeUnknownEffect, which takes unknown input and fails with a
// SchemaError, run with try (VIP-5), over generated inputs: valid ones,
// ones missing a field, ones with a field of the wrong type, and ones with a
// field the schema does not declare. A decode failure is a typed failure, so
// the Exit comparison checks the SchemaError's structure: its issue tree,
// field by field. Its message is SchemaIssue.defaultFormatter of that issue,
// a function of what the comparison already checks, so it decides nothing.
// Schema's functions are deterministic, so the program needs no
// synchronization.

func init() {
	// A schema declaration lowers to Schema calls, which need Schema bound
	// whether or not the source names it as a value.
	Register(&Construct{
		Key:      "vip15.schema-declaration-only",
		VIP:      15,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP:      15,
			Template: "const ‹Name› = Schema.Literals([‹literals›])",
			Quote:    `schema Code = "root_missing" | "read_failed"           // alias form`,
		}},
		// The probe declares a schema it never decodes, so its source
		// names Schema only in the import, and main succeeds.
		Focus: func(g *Gen, s *Scope) []Stmt {
			newSchemaAlias(g, 2)
			return []Stmt{&Event{Label: g.Label()}}
		},
	})
	Register(&Construct{
		Key:      "vip15.schema",
		VIP:      15,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      15,
				Template: "const ‹Name› = Schema.Struct({ ‹field›: Schema.String, ‹field›: Schema.optional(Schema.String), ‹field›: Schema.Literals([‹literals›]), ‹fields› })",
				Quote:    "`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.",
			},
			{
				VIP:      15,
				Template: "const ‹Name› = Schema.Literals([‹literals›])",
				Quote:    `schema Code = "root_missing" | "read_failed"           // alias form`,
			},
			{
				VIP:      15,
				Template: "Schema.optional(‹Schema›)",
				Quote:    "`name?: T` means `Schema.optional`, which accepts a missing key or `undefined`, matching TypeScript's default.",
			},
			{
				VIP:      14,
				Template: "Schema.Number",
				Quote:    "const Port = Schema.Number                       // Effect's Schema, no import",
			},
			{
				VIP:      15,
				Template: "yield* Schema.decodeUnknownEffect(‹Name›)(‹input›)",
				Quote:    "`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name.",
				Reading:  "VIP-15 names no decoding function. The constant is Effect's Schema, so the suite decodes unknown input with Effect's Schema.decodeUnknownEffect, which fails with a SchemaError, and runs it with try (yield*).",
			},
		},
		// The probe declares VIP-15's User shape, with an alias and a
		// struct that nests it:
		//
		//	schema S0 = "k0" | "k1"
		//	schema S1 { f0: string; f1?: string; f2: "l0" | "l1"; f3: S0 }
		//	schema S2 { f0: number; f1: S1 }
		//
		// It decodes a valid S2 whose S1 leaves out the optional field and
		// adds one the schema does not declare, logs what it decoded, then
		// decodes an S2 whose S1 has a number for its string f0, so main
		// fails with the SchemaError of that nested field.
		Focus: func(g *Gen, s *Scope) []Stmt {
			k := newSchemaAlias(g, 2)
			user := &SchemaDecl{Name: schemaName(g), Fields: []*SchemaField{
				{Name: "f0", Kind: fieldString},
				{Name: "f1", Kind: fieldString, Optional: true},
				{Name: "f2", Kind: fieldLiterals, Literals: []string{"l0", "l1"}},
				{Name: "f3", Kind: fieldRef, Ref: k},
			}}
			g.AddDecl(user)
			outer := &SchemaDecl{Name: schemaName(g), Fields: []*SchemaField{
				{Name: "f0", Kind: fieldNumber},
				{Name: "f1", Kind: fieldRef, Ref: user},
			}}
			g.AddDecl(outer)
			r, v := g.Name("r"), g.Name("v")
			valid := &ObjectLit{Entries: []Entry{
				{"f0", &Num{Value: 1}},
				{"f1", &ObjectLit{Entries: []Entry{{"f0", &Str{Value: "s0"}}, {"f2", &Str{Value: "l1"}}, {"f3", &Str{Value: "k1"}}, {"x", &Num{Value: 2}}}}},
			}}
			wrong := &ObjectLit{Entries: []Entry{
				{"f0", &Num{Value: 2}},
				{"f1", &ObjectLit{Entries: []Entry{{"f0", &Num{Value: 3}}, {"f2", &Str{Value: "l0"}}, {"f3", &Str{Value: "k0"}}}}},
			}}
			nested := &Field{X: &Ref{Name: r}, Name: "f1"}
			s.Locals = append(s.Locals, v)
			body := []Stmt{
				&Const{Name: r, Value: &Try{X: decode(g, outer, valid)}},
				&EvValue{X: &Field{X: nested, Name: "f3"}},
				&EvValue{X: &Default{X: &Field{X: nested, Name: "f1"}, Else: &Str{Value: "none"}}},
				&Const{Name: v, Value: &Field{X: &Ref{Name: r}, Name: "f0"}},
			}
			// A campaign's input leaves the failing decode out half the
			// time, so the statements it writes after the focus run.
			if g.Chance(2) {
				return body
			}
			return append(body, &ExprStmt{X: &Try{X: decode(g, outer, wrong)}})
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			d := pickSchema(g)
			r := g.Name("r")
			run := &Const{Name: r, Value: &Try{X: decode(g, d, schemaInput(g, s, d))}}
			return &Seq{Stmts: []Stmt{run, readDecoded(g, s, d, &Ref{Name: r})}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			d := pickSchema(g)
			x := decode(g, d, schemaInput(g, s, d))
			if !number {
				return x
			}
			f := d.numberField()
			if f == nil {
				return nil
			}
			// Effect.map gives the decoded number field, so the operand
			// succeeds with a number.
			g.UseEffect()
			r := g.Name("r")
			return &ModCall{Mod: "Effect", Fn: "map", Args: []Expr{x, &Arrow{Params: []string{r}, Body: &Field{X: &Ref{Name: r}, Name: f.Name}}}}
		},
	})
}

// A fieldKind is the TypeScript type of a schema field, which VIP-15 maps to
// a Schema.
type fieldKind int

const (
	fieldNumber   fieldKind = iota // number: Schema.Number
	fieldString                    // string: Schema.String
	fieldLiterals                  // "l0" | "l1": Schema.Literals(["l0", "l1"])
	fieldRef                       // another schema's name: that constant
)

// A SchemaField is one field of a schema or schema error declaration: its
// name, its type, and whether it is optional (`name?: T`).
type SchemaField struct {
	Name     string
	Kind     fieldKind
	Optional bool
	Literals []string
	Ref      *SchemaDecl
}

func (f *SchemaField) Vibe(w *Writer) {
	w.Write(f.Name)
	if f.Optional {
		w.Write("?")
	}
	w.Write(": ")
	switch f.Kind {
	case fieldNumber:
		w.Write("number")
	case fieldString:
		w.Write("string")
	case fieldLiterals:
		w.Write(literalUnion(f.Literals))
	case fieldRef:
		w.Write(f.Ref.Name)
	}
}

func (f *SchemaField) Effect(w *Writer) {
	w.Write(f.Name + ": ")
	if f.Optional {
		w.Write("Schema.optional(")
	}
	switch f.Kind {
	case fieldNumber:
		w.Write("Schema.Number")
	case fieldString:
		w.Write("Schema.String")
	case fieldLiterals:
		w.Write(schemaLiterals(f.Literals))
	case fieldRef:
		w.Write(f.Ref.Name)
	}
	if f.Optional {
		w.Write(")")
	}
}

// A SchemaDecl is `schema S0 { fields }`, read as
// `const S0 = Schema.Struct({ … })`, or with Alias set the alias form
// `schema K0 = "k0" | "k1"`, read as `const K0 = Schema.Literals([…])`.
type SchemaDecl struct {
	Name   string
	Fields []*SchemaField
	Alias  []string
}

func (d *SchemaDecl) Vibe(w *Writer) {
	if d.Alias != nil {
		w.Write("schema " + d.Name + " = " + literalUnion(d.Alias))
		return
	}
	w.Write("schema " + d.Name + " ")
	schemaFields(w, d.Fields, "; ")
}

func (d *SchemaDecl) Effect(w *Writer) {
	if d.Alias != nil {
		w.Write("const " + d.Name + " = " + schemaLiterals(d.Alias))
		return
	}
	w.Write("const " + d.Name + " = Schema.Struct(")
	schemaFields(w, d.Fields, ", ")
	w.Write(")")
}

// numberField returns the struct's first required number field, or nil.
func (d *SchemaDecl) numberField() *SchemaField {
	for _, f := range d.Fields {
		if f.Kind == fieldNumber && !f.Optional {
			return f
		}
	}
	return nil
}

// schemaFields prints `{ f0: …; f1: … }` with its separator, or `{}`.
func schemaFields(w *Writer, fields []*SchemaField, sep string) {
	if len(fields) == 0 {
		w.Write("{}")
		return
	}
	w.Write("{ ")
	for i, f := range fields {
		if i > 0 {
			w.Write(sep)
		}
		w.Node(f)
	}
	w.Write(" }")
}

func literalUnion(literals []string) string {
	quoted := make([]string, len(literals))
	for i, l := range literals {
		quoted[i] = strconv.Quote(l)
	}
	return strings.Join(quoted, " | ")
}

func schemaLiterals(literals []string) string {
	quoted := make([]string, len(literals))
	for i, l := range literals {
		quoted[i] = strconv.Quote(l)
	}
	return "Schema.Literals([" + strings.Join(quoted, ", ") + "])"
}

// An Entry is one key of an ObjectLit.
type Entry struct {
	Key   string
	Value Expr
}

// An ObjectLit is an object literal: { f0: 1, f1: "s0" }, in both prints.
type ObjectLit struct{ Entries []Entry }

func (o *ObjectLit) Vibe(w *Writer) {
	if len(o.Entries) == 0 {
		w.Write("{}")
		return
	}
	w.Write("{ ")
	for i, e := range o.Entries {
		if i > 0 {
			w.Write(", ")
		}
		w.Write(e.Key + ": ")
		w.Node(e.Value)
	}
	w.Write(" }")
}
func (o *ObjectLit) Effect(w *Writer) { o.Vibe(w) }

// An EvValue logs a string the program computed: ev(<X>).
type EvValue struct{ X Expr }

func (e *EvValue) Vibe(w *Writer) {
	w.Write("ev(")
	w.Node(e.X)
	w.Write(")")
}
func (e *EvValue) Effect(w *Writer) { e.Vibe(w) }
func (e *EvValue) Ends() bool       { return false }

// A Default is <X> ?? <Else>, in both prints, as the argument of ev.
type Default struct{ X, Else Expr }

func (d *Default) Vibe(w *Writer) {
	w.Node(d.X)
	w.Write(" ?? ")
	w.Node(d.Else)
}
func (d *Default) Effect(w *Writer) { d.Vibe(w) }

// decode is Schema.decodeUnknownEffect(<d>)(<input>). Both prints import
// Schema: VIP-14 would put it in scope in VibeLang, but an import is allowed
// too, so the construct does not need VIP-14.
func decode(g *Gen, d *SchemaDecl, input Expr) Expr {
	g.UseModule("Schema", true)
	return &Apply{F: &ModCall{Mod: "Schema", Fn: "decodeUnknownEffect", Args: []Expr{&Ref{Name: d.Name}}}, Args: []Expr{input}}
}

// schemaDecls returns the program's schema declarations so far.
func schemaDecls(g *Gen) []*SchemaDecl {
	var out []*SchemaDecl
	for _, d := range g.Decls() {
		if sd, ok := d.(*SchemaDecl); ok {
			out = append(out, sd)
		}
	}
	return out
}

// schemaName names the program's next schema, struct or alias: S0, S1.
func schemaName(g *Gen) string {
	return fmt.Sprintf("S%d", len(schemaDecls(g)))
}

// newSchemaAlias declares `schema S<i> = "<s>0" | "<s>1" …` with n
// literals.
func newSchemaAlias(g *Gen, n int) *SchemaDecl {
	d := &SchemaDecl{Name: schemaName(g)}
	for i := range n {
		d.Alias = append(d.Alias, fmt.Sprintf("k%d", i))
	}
	g.UseModule("Schema", true)
	g.AddDecl(d)
	return d
}

// newSchemaFields writes one to four fields for a schema or schema error.
// The first choice is a required number, so a minimal declaration has a
// number to read; a field may name a schema declared before it, so no
// constant is read before it is defined.
func newSchemaFields(g *Gen) []*SchemaField {
	var fields []*SchemaField
	earlier := schemaDecls(g)
	for i := range 1 + g.Intn(4) {
		f := &SchemaField{Name: fmt.Sprintf("f%d", i), Kind: fieldKind(g.Intn(4)), Optional: g.Chance(4)}
		switch f.Kind {
		case fieldLiterals:
			for j := range 2 + g.Intn(2) {
				f.Literals = append(f.Literals, fmt.Sprintf("l%d", j))
			}
		case fieldRef:
			if len(earlier) == 0 {
				f.Kind = fieldNumber
			} else {
				f.Ref = earlier[g.Intn(len(earlier))]
			}
		}
		fields = append(fields, f)
	}
	return fields
}

// newSchemaStruct declares `schema S<i> { fields }`.
func newSchemaStruct(g *Gen) *SchemaDecl {
	d := &SchemaDecl{Fields: newSchemaFields(g)}
	d.Name = schemaName(g)
	g.UseModule("Schema", true)
	g.AddDecl(d)
	return d
}

// pickSchema returns one of the program's schemas, declaring a new one, up
// to three, now and then. A minimal program's first schema is a struct.
func pickSchema(g *Gen) *SchemaDecl {
	have := schemaDecls(g)
	if len(have) == 0 || len(have) < 3 && g.Chance(3) {
		if g.Chance(3) {
			return newSchemaAlias(g, 2+g.Intn(2))
		}
		return newSchemaStruct(g)
	}
	return have[g.Intn(len(have))]
}

// schemaInput writes an unknown input to decode with a schema: the first
// choice is a valid one; otherwise it leaves out a field, gives one a value
// of the wrong type, or adds a field the schema does not declare, which
// Schema.decodeUnknownEffect ignores by default.
func schemaInput(g *Gen, s *Scope, d *SchemaDecl) Expr {
	return schemaValue(g, s, d, 0)
}

func schemaValue(g *Gen, s *Scope, d *SchemaDecl, depth int) Expr {
	if d.Alias != nil {
		switch g.Intn(4) {
		case 2:
			return &Str{Value: "zz"}
		case 3:
			return g.Num(s)
		}
		return &Str{Value: d.Alias[g.Intn(len(d.Alias))]}
	}
	o := &ObjectLit{}
	for _, f := range d.Fields {
		switch g.Intn(8) {
		case 5:
			// The field is missing: valid only when it is optional.
			continue
		case 6:
			o.Entries = append(o.Entries, Entry{f.Name, wrongValue(g, s, f)})
			continue
		case 7:
			if f.Optional {
				o.Entries = append(o.Entries, Entry{f.Name, &Lit{Text: "undefined"}})
				continue
			}
		}
		o.Entries = append(o.Entries, Entry{f.Name, fieldValue(g, s, f, depth)})
	}
	if g.Chance(4) {
		o.Entries = append(o.Entries, Entry{"x", g.Num(s)})
	}
	return o
}

// fieldValue writes a valid value of a field's type.
func fieldValue(g *Gen, s *Scope, f *SchemaField, depth int) Expr {
	switch f.Kind {
	case fieldString:
		return &Str{Value: fmt.Sprintf("s%d", g.Intn(3))}
	case fieldLiterals:
		return &Str{Value: f.Literals[g.Intn(len(f.Literals))]}
	case fieldRef:
		if depth >= maxDepth {
			return validValue(g, s, f.Ref)
		}
		return schemaValue(g, s, f.Ref, depth+1)
	}
	return g.Num(s)
}

// validValue writes a valid value of a schema, with no choice of fault, so
// that nesting ends.
func validValue(g *Gen, s *Scope, d *SchemaDecl) Expr {
	if d.Alias != nil {
		return &Str{Value: d.Alias[0]}
	}
	o := &ObjectLit{}
	for _, f := range d.Fields {
		if f.Optional {
			continue
		}
		if f.Kind == fieldRef {
			o.Entries = append(o.Entries, Entry{f.Name, validValue(g, s, f.Ref)})
			continue
		}
		o.Entries = append(o.Entries, Entry{f.Name, fieldValue(g, s, f, maxDepth)})
	}
	return o
}

// wrongValue writes a value no field of f's type accepts.
func wrongValue(g *Gen, s *Scope, f *SchemaField) Expr {
	switch f.Kind {
	case fieldNumber:
		return &Str{Value: "s9"}
	case fieldLiterals:
		return &Str{Value: "zz"}
	case fieldRef:
		if f.Ref.Alias != nil {
			return &Str{Value: "zz"}
		}
		return &Str{Value: "s9"}
	}
	return g.Num(s)
}

// readDecoded reads what a decode gave: a struct's required number field
// into a new local, or its string field into the log; an alias's literal
// into the log.
func readDecoded(g *Gen, s *Scope, d *SchemaDecl, r Expr) Stmt {
	if d.Alias != nil {
		return &EvValue{X: r}
	}
	f := d.Fields[g.Intn(len(d.Fields))]
	switch {
	case f.Kind == fieldNumber && !f.Optional:
		v := g.Name("v")
		s.Locals = append(s.Locals, v)
		return &Const{Name: v, Value: &Field{X: r, Name: f.Name}}
	case f.Kind == fieldString || f.Kind == fieldLiterals || f.Kind == fieldRef && f.Ref.Alias != nil:
		x := Expr(&Field{X: r, Name: f.Name})
		if f.Optional {
			x = &Default{X: x, Else: &Str{Value: "none"}}
		}
		return &EvValue{X: x}
	}
	return &Event{Label: g.Label()}
}

// schemaProbes are the values each mapping witness tests with Schema.is, one
// of each shape the mapping table names, so a schema mapped to the wrong
// row accepts or rejects a different set.
const schemaProbes = `["x", 7, true, 7n, Symbol.for("token"), ["x"], ["x", 1, 2], null, undefined, [7], ["x", 7], { a: 7 }, { active: true }, {}]`

// The rows of chapter 6's mapping table. Each witness declares a schema per
// type of the row, in VibeLang as `schema Sn = type` and in the reference as
// the row's Effect schema, and returns which probes each accepts.
var schemaRows = []struct {
	key, row string
	types    [][2]string
}{
	{"primitives", "| `string`, `number`, `boolean`, `bigint`, `symbol` | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt`, `Schema.Symbol` |", [][2]string{{"string", "Schema.String"}, {"number", "Schema.Number"}, {"boolean", "Schema.Boolean"}, {"bigint", "Schema.BigInt"}, {"symbol", "Schema.Symbol"}}},
	{"literals", "| single literal `\"a\"` | `Schema.Literal(\"a\")` (likewise numeric, boolean and bigint literals) |", [][2]string{{`"x"`, `Schema.Literal("x")`}, {"7", "Schema.Literal(7)"}, {"true", "Schema.Literal(true)"}, {"7n", "Schema.Literal(7n)"}}},
	{"literal-union", "| union consisting entirely of literals `\"a\" \\| \"b\"` | `Schema.Literals([\"a\", \"b\"])` |", [][2]string{{`"x" | 7`, `Schema.Literals(["x", 7])`}}},
	{"union", "For example, `\"a\" | \"b\" | null` maps to `Schema.Union([Schema.Literal(\"a\"), Schema.Literal(\"b\"), Schema.Null])`; it does not group the string literals into `Schema.Literals`.", [][2]string{{`"x" | "y" | null`, `Schema.Union([Schema.Literal("x"), Schema.Literal("y"), Schema.Null])`}, {"string | number[]", "Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.Number))])"}}},
	{"null-undefined", "| `null`, `undefined` | `Schema.Null`, `Schema.Undefined` |", [][2]string{{"null", "Schema.Null"}, {"undefined", "Schema.Undefined"}}},
	{"array", "| `T[]`, `Array<T>` | `Schema.mutable(Schema.Array(S))` |", [][2]string{{"number[]", "Schema.mutable(Schema.Array(Schema.Number))"}, {"Array<string>", "Schema.mutable(Schema.Array(Schema.String))"}}},
	{"readonly-array", "| `readonly T[]`, `ReadonlyArray<T>` | `Schema.Array(S)` |", [][2]string{{"readonly number[]", "Schema.Array(Schema.Number)"}, {"ReadonlyArray<string>", "Schema.Array(Schema.String)"}}},
	{"tuple", "| `[A, B]` | `Schema.mutable(Schema.Tuple([A, B]))` |", [][2]string{{"[string, number]", "Schema.mutable(Schema.Tuple([Schema.String, Schema.Number]))"}}},
	{"readonly-tuple", "| `readonly [A, B]` | `Schema.Tuple([A, B])` |", [][2]string{{"readonly [string, number]", "Schema.Tuple([Schema.String, Schema.Number])"}}},
	{"optional-tuple", "| `[A, B?]` | `Schema.mutable(Schema.Tuple([A, Schema.optional(B)]))` |", [][2]string{{"[name: string, count?: number]", "Schema.mutable(Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]))"}, {"readonly [name: string, count?: number]", "Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])"}}},
	{"rest-tuple", "Tuple element labels (`[name: A, count?: B]`) do not change the mapping.", [][2]string{{"[string, ...number[]]", "Schema.mutable(Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number]))"}, {"readonly [string, ...number[]]", "Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number])"}, {"[string, ...number[], boolean]", "Schema.mutable(Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number, Schema.Boolean]))"}}},
	{"record", "| `Record<K, V>` | `Schema.Record(K, Schema.mutableKey(V))` |", [][2]string{{"Record<string, number>", "Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))"}}},
	{"readonly-record", "| `Readonly<Record<K, V>>` | `Schema.Record(K, V)` |", [][2]string{{"Readonly<Record<string, number>>", "Schema.Record(Schema.String, Schema.Number)"}}},
	{"nested", "| nested object `{ name: T }` | `Schema.Struct({ name: Schema.mutableKey(S) })` |", [][2]string{{"{ active: boolean }", "Schema.Struct({ active: Schema.mutableKey(Schema.Boolean) })"}}},
}

func init() {
	for _, r := range schemaRows {
		var vibe, ref, results []string
		for i, t := range r.types {
			name := fmt.Sprintf("S%d", i)
			vibe = append(vibe, fmt.Sprintf("schema %s = %s", name, t[0]))
			ref = append(ref, fmt.Sprintf("const %s = %s", name, t[1]))
			results = append(results, fmt.Sprintf("probes.map((v) => Schema.is(%s)(v))", name))
			// is alone cannot distinguish grouped literal members or readonly ASTs.
			// Compare the public schema shape with the chapter's exact Effect schema.
			results = append(results, fmt.Sprintf("Object.keys(%s).sort()", name))
			results = append(results, fmt.Sprintf(`JSON.stringify(%s.ast, (_, v) => typeof v === "bigint" ? { bigint: String(v) } : v)`, name))
		}
		body := "function witness() {\n  const probes: unknown[] = " + schemaProbes + "\n  return [" + strings.Join(results, ", ") + "]\n}"
		registerWitness(15, ChapterWitness{
			Key:     "vip15.schema-" + r.key + "-plain",
			Chapter: "006-data.md",
			Quote:   r.row,
			Modules: []string{"Schema"},
			Vibe:    strings.Join(vibe, "\n") + "\n" + body,
			Effect:  strings.Join(ref, "\n") + "\n" + strings.ReplaceAll(body, ": unknown[]", ""),
			Cite:    Citation{VIP: 15, Template: r.types[0][1], Quote: "Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error."},
		})
	}
	for _, w := range []ChapterWitness{
		{
			// Chapter 6's own example, decoded and mutated as it shows.
			Key:     "vip15.schema-sample-plain",
			Chapter: "006-data.md",
			Quote:   "Mappings preserve TypeScript mutability: properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`.",
			Vibe: `schema Sample {
  kind: "sample";
  value: string | null;
  absent: undefined;
  items: number[];
  readonly pair: readonly [string, number];
  counts: Record<string, number>;
  nested: { active: boolean };
}
function witness() {
  const sample = Schema.decodeUnknownSync(Sample)({
    kind: "sample", value: null, absent: undefined, items: [1],
    pair: ["a", 2], counts: { a: 1 }, nested: { active: true },
  })
  sample.items.push(2)
  sample.counts.a = 2
  return [sample, Schema.is(Sample)({ ...sample, kind: "other" })]
}`,
			Effect: `const Sample = Schema.Struct({
  kind: Schema.mutableKey(Schema.Literal("sample")),
  value: Schema.mutableKey(Schema.Union([Schema.String, Schema.Null])),
  absent: Schema.mutableKey(Schema.Undefined),
  items: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number))),
  pair: Schema.Tuple([Schema.String, Schema.Number]),
  counts: Schema.mutableKey(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))),
  nested: Schema.mutableKey(Schema.Struct({ active: Schema.mutableKey(Schema.Boolean) })),
})
function witness() {
  const sample = Schema.decodeUnknownSync(Sample)({
    kind: "sample", value: null, absent: undefined, items: [1],
    pair: ["a", 2], counts: { a: 1 }, nested: { active: true },
  })
  sample.items.push(2)
  sample.counts.a = 2
  return [sample, Schema.is(Sample)({ ...sample, kind: "other" })]
}`,
			Modules: []string{"Schema"},
			Cite:    Citation{VIP: 15, Template: "Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Number)))", Quote: "Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error."},
		},
		{
			Key:     "vip15.schema-optional-plain",
			Chapter: "006-data.md",
			Quote:   "`Schema.optional` accepts a missing key or `undefined`, matching TypeScript’s default.",
			Vibe: `schema S0 { x?: string; readonly y?: number }
function witness() {
  const probes: unknown[] = [{}, { x: undefined }, { x: "a", y: 1 }, { x: 1 }, { y: "b" }]
  return [probes.map((v) => Schema.is(S0)(v)), "x" in Schema.decodeUnknownSync(S0)({})]
}`,
			Effect: `const S0 = Schema.Struct({ x: Schema.mutableKey(Schema.optional(Schema.String)), y: Schema.optional(Schema.Number) })
function witness() {
  const probes = [{}, { x: undefined }, { x: "a", y: 1 }, { x: 1 }, { y: "b" }]
  return [probes.map((v) => Schema.is(S0)(v)), "x" in Schema.decodeUnknownSync(S0)({})]
}`,
			Modules: []string{"Schema"},
			Cite:    Citation{VIP: 15, Template: "Schema.mutableKey(Schema.optional(Schema.String))", Quote: "Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error."},
		},
		{
			// Review round 4: a named Schema constant was remapped.
			Key:     "vip15.schema-reference-plain",
			Chapter: "006-data.md",
			Quote:   "Refinements and transformations stay Schema constants.",
			Vibe: `type Count = boolean
const Count = Schema.NumberFromString
schema Address { city: string }
schema S0 { n: Count; home: Address }
function witness() {
  return Schema.decodeUnknownSync(S0)({ n: "7", home: { city: "x" } })
}`,
			Effect: `const Count = Schema.NumberFromString
const Address = Schema.Struct({ city: Schema.mutableKey(Schema.String) })
const S0 = Schema.Struct({ n: Schema.mutableKey(Count), home: Schema.mutableKey(Address) })
function witness() {
  return Schema.decodeUnknownSync(S0)({ n: "7", home: { city: "x" } })
}`,
			Modules: []string{"Schema"},
			Cite:    Citation{VIP: 15, Template: "Schema.mutableKey(Count)", Quote: "Each field's schema is written from its TypeScript type: primitives, literals, unions, arrays, tuples, `Record`, nested object types, or another schema's name. A type outside that mapping is a compile error."},
		},
	} {
		registerWitness(15, w)
	}
}

func init() {
	registerWitness(15, ChapterWitness{Key: "vip15.computed-keys-plain", Chapter: "006-data.md", Quote: "Evaluate each admitted key once at the declaration's existing execution point in native property evaluation order", Vibe: "const trace:string[]=[];function key(s:string):string{trace.push(s);return s};schema S {[key(\"a\")]:number;[key(\"b\")]:string};function witness(){return [trace,Schema.decodeUnknownSync(S)({a:1,b:\"x\",extra:true}),Schema.is(S)({other:1})]}", Effect: "const trace=[];function key(s){trace.push(s);return s};const S=Schema.Struct({[key(\"a\")]:Schema.mutableKey(Schema.Number),[key(\"b\")]:Schema.mutableKey(Schema.String)});function witness(){return [trace,Schema.decodeUnknownSync(S)({a:1,b:\"x\",extra:true}),Schema.is(S)({other:1})]}", Modules: []string{"Schema"}, Cite: Citation{VIP: 15, Template: "Schema.Struct", Quote: "`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name."}})
}

func init() {
	registerWitness(15, ChapterWitness{Key: "vip15.tdz-plain", Chapter: "006-data.md", Quote: "There is no implicit reordering or `Schema.suspend`", Vibe: "function witness():boolean{if(!Schema.is(Schema.Number)(0))return false;try{function build():Schema.Top {schema A {b:B};return A};const a=build();schema B {n:number};return false}catch(e){return e instanceof ReferenceError}}", Effect: "function witness(){if(!Schema.is(Schema.Number)(0))return false;try{function build(){const A=Schema.Struct({b:Schema.mutableKey(B)});return A};const a=build();const B=Schema.Struct({n:Schema.mutableKey(Schema.Number)});return false}catch(e){return e instanceof ReferenceError}}", Modules: []string{"Schema"}, Cite: Citation{VIP: 15, Template: "Schema.Struct", Quote: "`schema Name { fields }` and `schema Name = type` declare a Schema constant and its type under one name."}})
}
