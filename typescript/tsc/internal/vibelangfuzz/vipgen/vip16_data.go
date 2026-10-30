package vipgen

import (
	"fmt"
	"strings"
)

// VIP-16: `data` declarations. "`data Name { Variant; Variant { fields } }`
// declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum`
// constructors under one name." The reference is VIP-16's
// `const Delivery = Data.taggedEnum<Delivery>()`, less what ref.mjs, untyped
// JavaScript, cannot hold: the `type` line and the type argument, which
// change nothing that runs. A variant is built with its constructor,
// `D0.V1({ n: 1 })`, in both prints, as VIP-16's
// `Delivery.Sent({ tracking: "1Z" })`. VIP-28's generic data is the same
// node with type parameters.

func init() {
	Register(&Construct{
		Key:       "vip16.data",
		VIP:       16,
		Requires:  []string{"vip01.effect-function"},
		Citations: dataCitations,
		Focus:     dataFocus,
		Stmt:      func(g *Gen, s *Scope) Stmt { return dataStmt(g, s, pickData(g, false)) },
	})
	// The plain form builds and reads the same values in a plain program,
	// so it is compared before VIP-1's effect functions compile.
	Register(&Construct{
		Key:       "vip16.data-plain",
		VIP:       16,
		Plain:     true,
		Citations: dataCitations,
		Focus:     dataFocus,
		Stmt:      func(g *Gen, s *Scope) Stmt { return dataStmt(g, s, pickData(g, false)) },
	})
}

// dataFocus declares `data D0 { V0; V1 { n: number } }`, logs each
// variant's _tag, and binds v to the field of the variant built with one,
// which main returns.
func dataFocus(g *Gen, s *Scope) []Stmt {
	d := minimalData(g)
	v := g.Name("v")
	read := &Const{Name: v, Value: &Field{X: &DataNew{Decl: d, Variant: d.Variants[1], N: &Num{Value: 1}}, Name: "n"}}
	s.Locals = append(s.Locals, v)
	return []Stmt{&TagEvent{X: &DataNew{Decl: d, Variant: d.Variants[0]}}, read}
}

// dataCitations are the citations of both data constructs.
var dataCitations = []Citation{
	{
		VIP:      16,
		Template: "const ‹Name› = Data.taggedEnum‹<Name>›()",
		Quote:    "`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name.",
	},
	{
		VIP:      16,
		Template: "‹Name›.‹Variant›({ ‹fields› })",
		Quote:    `const d = Delivery.Sent({ tracking: "1Z" })`,
	},
}

// A DataDecl is `data D0 { V0; V1 { n: number } }`, or with Params VIP-28's
// `data G0<A, B> { V0 { n: A }; V1 { n: B } }`, read as
// `const D0 = Data.taggedEnum()`.
type DataDecl struct {
	Name     string
	Params   []string
	Variants []*DataVariant
}

// A DataVariant has no field, or the one field n of type Type.
type DataVariant struct {
	Name  string
	Field bool
	Type  string
}

func (d *DataDecl) Vibe(w *Writer) {
	w.Write("data " + d.Name)
	if len(d.Params) > 0 {
		w.Write("<" + strings.Join(d.Params, ", ") + ">")
	}
	var variants []string
	for _, v := range d.Variants {
		if v.Field {
			variants = append(variants, v.Name+" { n: "+v.Type+" }")
		} else {
			variants = append(variants, v.Name)
		}
	}
	w.Write(" { " + strings.Join(variants, "; ") + " }")
}

func (d *DataDecl) Effect(w *Writer) {
	w.Write("const " + d.Name + " = Data.taggedEnum()")
}

// TypeName is the declaration's type with every parameter number: D0, or
// G0<number, number>.
func (d *DataDecl) TypeName() string {
	if len(d.Params) == 0 {
		return d.Name
	}
	args := make([]string, len(d.Params))
	for i := range args {
		args[i] = "number"
	}
	return d.Name + "<" + strings.Join(args, ", ") + ">"
}

// A DataNew builds a variant: D0.V1({ n: <N> }), or D0.V0() for a variant
// with no field, in both prints.
type DataNew struct {
	Decl    *DataDecl
	Variant *DataVariant
	N       Expr
}

func (n *DataNew) Vibe(w *Writer) {
	w.Write(n.Decl.Name + "." + n.Variant.Name + "(")
	if n.Variant.Field {
		w.Write("{ n: ")
		w.Node(n.N)
		w.Write(" }")
	}
	w.Write(")")
}
func (n *DataNew) Effect(w *Writer) { n.Vibe(w) }

// A TagEvent logs a value's tag: ev(<X>._tag).
type TagEvent struct{ X Expr }

func (t *TagEvent) Vibe(w *Writer) {
	w.Write("ev(")
	w.Node(t.X)
	w.Write("._tag)")
}
func (t *TagEvent) Effect(w *Writer) { t.Vibe(w) }
func (t *TagEvent) Ends() bool       { return false }

// A DataConst binds a data value with its declared type, so the value has
// the whole union's type: `const d0 = (…) as D0`. An annotation, `const d0: D0
// = D0.V0()`, would not: TypeScript narrows a union-typed const to the type
// of its initializer, and a match arm for another variant is then an error
// (TS2367). The reference is untyped, so it drops the assertion.
type DataConst struct {
	Name  string
	Type  string
	Value Expr
}

func (c *DataConst) Vibe(w *Writer) {
	w.Write("const " + c.Name + " = (")
	w.Node(c.Value)
	w.Write(") as " + c.Type)
}

func (c *DataConst) Effect(w *Writer) {
	w.Write("const " + c.Name + " = ")
	w.Node(c.Value)
}

func (c *DataConst) Ends() bool { return false }

// dataDecls returns the program's data declarations so far, generic or not.
func dataDecls(g *Gen, generic bool) []*DataDecl {
	var out []*DataDecl
	for _, d := range g.Decls() {
		if dd, ok := d.(*DataDecl); ok && (len(dd.Params) > 0) == generic {
			out = append(out, dd)
		}
	}
	return out
}

// newDataDecl declares the program's next data union. A minimal one is
// `data D0 { V0; V1 { n: number } }`. A generic one (VIP-28) has one to
// four type parameters, "the limit of Effect's own `WithGenerics`", each
// the type of one variant's field, so every parameter is used, and maybe a
// variant with no field.
func newDataDecl(g *Gen, generic bool) *DataDecl {
	var d *DataDecl
	if generic {
		d = &DataDecl{Name: fmt.Sprintf("G%d", len(dataDecls(g, true)))}
		for i := range 1 + g.Intn(4) {
			p := string(rune('A' + i))
			d.Params = append(d.Params, p)
			d.Variants = append(d.Variants, &DataVariant{Field: true, Type: p})
		}
		if g.Chance(2) {
			d.Variants = append(d.Variants, &DataVariant{})
		}
	} else {
		d = &DataDecl{Name: fmt.Sprintf("D%d", len(dataDecls(g, false)))}
		for i := range 2 + g.Intn(2) {
			field := !g.Chance(3)
			if i == 0 {
				field = g.Chance(2)
			}
			d.Variants = append(d.Variants, &DataVariant{Field: field, Type: "number"})
		}
	}
	for i, v := range d.Variants {
		v.Name = fmt.Sprintf("V%d", i)
	}
	g.AddDecl(d)
	return d
}

// minimalData declares `data D0 { V0; V1 { n: number } }` whatever the
// input, for a probe that needs those two variants.
func minimalData(g *Gen) *DataDecl {
	d := &DataDecl{
		Name:     fmt.Sprintf("D%d", len(dataDecls(g, false))),
		Variants: []*DataVariant{{Name: "V0"}, {Name: "V1", Field: true, Type: "number"}},
	}
	g.AddDecl(d)
	return d
}

// pickData returns one of the program's data unions, declaring a new one,
// up to two of each kind, now and then, and records that the program holds
// generic data when it is generic.
func pickData(g *Gen, generic bool) *DataDecl {
	if generic {
		g.Use(genericDataKey(g))
	}
	have := dataDecls(g, generic)
	if len(have) == 0 || len(have) < 2 && g.Chance(3) {
		return newDataDecl(g, generic)
	}
	return have[g.Intn(len(have))]
}

// newVariant builds one of a union's variants.
func newVariant(g *Gen, s *Scope, d *DataDecl) *DataNew {
	n := &DataNew{Decl: d, Variant: d.Variants[g.Intn(len(d.Variants))]}
	if n.Variant.Field {
		n.N = g.Num(s)
	}
	return n
}

// dataStmt reads the field of a variant it builds, or logs its tag.
func dataStmt(g *Gen, s *Scope, d *DataDecl) Stmt {
	n := newVariant(g, s, d)
	if n.Variant.Field && !g.Chance(3) {
		v := g.Name("v")
		st := &Const{Name: v, Value: &Field{X: n, Name: "n"}}
		s.Locals = append(s.Locals, v)
		return st
	}
	return &TagEvent{X: n}
}

func init() {
	// Decided detail 25: `data Empty {}` is allowed, an exact empty
	// Data.TaggedEnum.
	registerWitness(16, ChapterWitness{
		Key:     "vip16.empty-data-plain",
		Chapter: "006-data.md",
		Quote:   "Zero variants are allowed",
		Vibe:    "data Empty {}\nfunction witness() {\n  return [typeof Empty, typeof (Empty as any).$is, typeof (Empty as any).$match]\n}",
		Effect:  "const Empty = Data.taggedEnum()\nfunction witness() {\n  return [typeof Empty, typeof Empty.$is, typeof Empty.$match]\n}",
		Cite:    Citation{VIP: 16, Template: "const Empty = Data.taggedEnum()", Quote: "`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name."},
	})
}

func init() {
	registerWitness(16, ChapterWitness{Key: "vip16.no-matcher-plain", Chapter: "006-data.md", Quote: "The variant constructors get no custom matchers.", Vibe: "data D {V};function witness(){return Object.hasOwn(D.V,Symbol.customMatcher)}", Effect: "const D=Data.taggedEnum();function witness(){return Object.hasOwn(D.V,Symbol.customMatcher)}", Modules: []string{}, Cite: Citation{VIP: 16, Template: "Data.taggedEnum()", Quote: "The variant constructors get no custom matchers."}})
}

func init() {
	registerWitness(16, ChapterWitness{Key: "vip16.no-validation-plain", Chapter: "006-data.md", Quote: "This adds no runtime validation or wrapping to `Data.taggedEnum`.", Vibe: "data D { V { n:number } }; function witness(){return D.V({n:\"unchecked\"} as any).n}", Effect: "const D=Data.taggedEnum(); function witness(){return D.V({n:\"unchecked\"}).n}", Modules: []string{}, Requires: []string{}, Cite: Citation{VIP: 16, Template: "Data.taggedEnum()", Quote: "`data Name { Variant; Variant { fields } }` declares Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name."}})
}
