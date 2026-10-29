package vipgen

// VIP-28: generic `data` unions, "exactly Effect TS's generic TaggedEnum
// pattern": `const Outcome = Data.taggedEnum<OutcomeDefinition>()`. The
// `type` alias and the `WithGenerics` interface are types only, so ref.mjs,
// untyped JavaScript, holds the const alone, and a generic union's nodes are
// VIP-16's with type parameters (vip16_data.go). Every parameter is number
// where a program uses the union.

func init() {
	Register(&Construct{
		Key:      "vip28.generic-data",
		VIP:      28,
		Requires: []string{"vip01.effect-function", "vip16.data"},
		Citations: []Citation{{
			VIP:      28,
			Template: "const ‹Name› = Data.taggedEnum‹<NameDefinition>›()",
			Quote:    "A `data` declaration (VIP-16) may have up to 4 type parameters, which is the limit of Effect's own `WithGenerics`.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			d := newDataDecl(g, true)
			v := g.Name("v")
			read := &Const{Name: v, Value: &Field{X: &DataNew{Decl: d, Variant: d.Variants[0], N: &Num{Value: 1}}, Name: "n"}}
			s.Locals = append(s.Locals, v)
			return []Stmt{&TagEvent{X: &DataNew{Decl: d, Variant: d.Variants[0], N: &Num{Value: 2}}}, read}
		},
		Stmt: func(g *Gen, s *Scope) Stmt { return dataStmt(g, s, pickData(g, true)) },
	})
}
