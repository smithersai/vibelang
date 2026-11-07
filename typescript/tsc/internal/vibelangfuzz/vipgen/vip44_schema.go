package vipgen

// VIP-44 amends VIP-15's schema mapping: the TypeScript-library Date, URL,
// RegExp, Uint8Array, ReadonlySet and ReadonlyMap map to Effect's own Schemas.
func init() {
	registerWitness(44, ChapterWitness{
		Key:     "vip44.schema-library-types-plain",
		Chapter: "006-data.md",
		Quote:   "In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax.",
		Modules: []string{"Schema"},
		Vibe: `schema Order { id: string; at: Date; tags: ReadonlySet<string>; counts: ReadonlyMap<string, number>; site: URL; pattern: RegExp; bytes: Uint8Array }
function witness() {
  const good = { id: "a", at: new Date(0), tags: new Set(["x"]), counts: new Map([["a", 1]]), site: new URL("https://x.dev/a"), pattern: /a/g, bytes: new Uint8Array([1]) }
  const probes: unknown[] = [good, { ...good, at: "1970" }, { ...good, tags: ["x"] }, { ...good, counts: new Map([["a", "1"]]) }, { ...good, site: "https://x.dev/a" }, { ...good, pattern: "a" }, { ...good, bytes: [1] }]
  return probes.map((v) => Schema.is(Order)(v))
}`,
		Effect: `const Order = Schema.Struct({ id: Schema.mutableKey(Schema.String), at: Schema.mutableKey(Schema.Date), tags: Schema.mutableKey(Schema.ReadonlySet(Schema.String)), counts: Schema.mutableKey(Schema.ReadonlyMap(Schema.String, Schema.Number)), site: Schema.mutableKey(Schema.URL), pattern: Schema.mutableKey(Schema.RegExp), bytes: Schema.mutableKey(Schema.Uint8Array) })
function witness() {
  const good = { id: "a", at: new Date(0), tags: new Set(["x"]), counts: new Map([["a", 1]]), site: new URL("https://x.dev/a"), pattern: /a/g, bytes: new Uint8Array([1]) }
  const probes = [good, { ...good, at: "1970" }, { ...good, tags: ["x"] }, { ...good, counts: new Map([["a", "1"]]) }, { ...good, site: "https://x.dev/a" }, { ...good, pattern: "a" }, { ...good, bytes: [1] }]
  return probes.map((v) => Schema.is(Order)(v))
}`,
		Cite: Citation{VIP: 44, Template: "Schema.ReadonlySet(Schema.String)", Quote: "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do."},
	})
}
