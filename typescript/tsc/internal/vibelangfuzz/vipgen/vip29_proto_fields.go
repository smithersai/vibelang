package vipgen

// VIP-29 reuses VIP-15's field mapping, including detail 111's own-key
// construction. Keep this schema-error probe separate from the plain schema
// probe so both have a stable keyed corpus and a minimal failing witness.
func init() {
	Register(&Construct{
		Key: "vip29.schema-error-proto-field", VIP: 29,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      29,
			Template: "class ‹Name› extends Schema.TaggedError‹<Name>›()(‹tag›, { [\"__proto__\"]: Schema.String }) {}",
			Quote:    "`schema error Name { fields }` combines VIP-13 (`error`) and VIP-15 (field mapping). Fields are written as TypeScript types and mapped to Schemas. Transport compatibility follows their encoded representations, as above.",
			Reading:  "Decided detail 111 requires own computed __proto__ field keys in schema errors too. The reference retains VIP-29's Schema.TaggedError class, with that fields-object construction repair. Decode valid, missing and wrong-type inputs, and construct a valid instance; compare tags and scalar own-field observations inside Effect.sync. Type arguments are erased for ref.mjs.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{protoFieldProbe(g, true)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return protoFieldProbe(g, true) },
	})
}
