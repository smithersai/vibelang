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

	// Nested collection mappings compose independently of scalar mappings.
	registerWitness(44, ChapterWitness{
		Key:     "vip44.schema-library-nested-plain",
		Chapter: "006-data.md",
		Quote:   "In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax.",
		Modules: []string{"Schema"},
		Vibe: `schema witnessNestedCollections { maps: ReadonlyArray<ReadonlyMap<string, number>>; sets: ReadonlySet<Record<string, number>>; both: ReadonlySet<ReadonlyMap<string, Date>>; writable: Array<ReadonlyMap<string, boolean>> }
function witness() {
  const good = { maps: [new Map([["a", 1]])], sets: new Set([{ a: 1 }]), both: new Set([new Map([["t", new Date(0)]])]), writable: [new Map([["x", true]])] }
  const probes: unknown[] = [good, { ...good, maps: [{ a: 1 }] }, { ...good, maps: [new Map([["a", "1"]])] }, { ...good, sets: new Set([{ a: "1" }]) }, { ...good, sets: [{ a: 1 }] }, { ...good, both: new Set([new Map([["t", "1970"]])]) }, { ...good, writable: new Set() }]
  return probes.map((v) => Schema.is(witnessNestedCollections)(v))
}`,
		Effect: `const witnessNestedCollections = Schema.Struct({ maps: Schema.mutableKey(Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Number))), sets: Schema.mutableKey(Schema.ReadonlySet(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number)))), both: Schema.mutableKey(Schema.ReadonlySet(Schema.ReadonlyMap(Schema.String, Schema.Date))), writable: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Boolean)))) })
function witness() {
  const good = { maps: [new Map([["a", 1]])], sets: new Set([{ a: 1 }]), both: new Set([new Map([["t", new Date(0)]])]), writable: [new Map([["x", true]])] }
  const probes = [good, { ...good, maps: [{ a: 1 }] }, { ...good, maps: [new Map([["a", "1"]])] }, { ...good, sets: new Set([{ a: "1" }]) }, { ...good, sets: [{ a: 1 }] }, { ...good, both: new Set([new Map([["t", "1970"]])]) }, { ...good, writable: new Set() }]
  return probes.map((v) => Schema.is(witnessNestedCollections)(v))
}`,
		Cite: Citation{VIP: 44, Template: "Schema.ReadonlySet(", Quote: "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do."},
	})
	// A ReadonlyMap key is any schema: the checker checks the selected
	// Schema.ReadonlyMap call, not the Record candidate's key constraint.
	registerWitness(44, ChapterWitness{
		Key:     "vip44.schema-library-map-keys-plain",
		Chapter: "006-data.md",
		Quote:   "In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax.",
		Modules: []string{"Schema"},
		Vibe: `schema witnessMapKeys { byDate: ReadonlyMap<Date, number>; bySet: ReadonlyMap<ReadonlySet<string>, boolean>; byPair: ReadonlyMap<readonly [string, number], string> }
function witness() {
  const good = { byDate: new Map([[new Date(0), 1]]), bySet: new Map([[new Set(["k"]), true]]), byPair: new Map([[["a", 1] as const, "x"]]) }
  const probes: unknown[] = [good, { ...good, byDate: new Map([["1970", 1]]) }, { ...good, byDate: new Map([[new Date(NaN), 1]]) }, { ...good, bySet: new Map([[["k"], true]]) }, { ...good, byPair: new Map([[["a", "1"], "x"]]) }, { ...good, byPair: {} }]
  return probes.map((v) => Schema.is(witnessMapKeys)(v))
}`,
		Effect: `const witnessMapKeys = Schema.Struct({ byDate: Schema.mutableKey(Schema.ReadonlyMap(Schema.Date, Schema.Number)), bySet: Schema.mutableKey(Schema.ReadonlyMap(Schema.ReadonlySet(Schema.String), Schema.Boolean)), byPair: Schema.mutableKey(Schema.ReadonlyMap(Schema.Tuple([Schema.String, Schema.Number]), Schema.String)) })
function witness() {
  const good = { byDate: new Map([[new Date(0), 1]]), bySet: new Map([[new Set(["k"]), true]]), byPair: new Map([[["a", 1], "x"]]) }
  const probes = [good, { ...good, byDate: new Map([["1970", 1]]) }, { ...good, byDate: new Map([[new Date(NaN), 1]]) }, { ...good, bySet: new Map([[["k"], true]]) }, { ...good, byPair: new Map([[["a", "1"], "x"]]) }, { ...good, byPair: {} }]
  return probes.map((v) => Schema.is(witnessMapKeys)(v))
}`,
		Cite: Citation{VIP: 44, Template: "Schema.ReadonlyMap(", Quote: "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do."},
	})
}

// The Error row: a refined Schema.Defect that accepts only Error instances.
func init() {
	registerWitness(44, ChapterWitness{
		Key:     "vip44.schema-error-field-plain",
		Chapter: "006-data.md",
		Quote:   "In this table, `S`, `A` and `B` are the recursively mapped schemas of the corresponding type syntax.",
		Modules: []string{"Schema"},
		Vibe: `schema Failure { cause: Error }
function witness() {
  const probes: unknown[] = [{ cause: new Error("x") }, { cause: new TypeError("t") }, { cause: { message: "x" } }, { cause: "x" }, {}]
  return probes.map((v) => Schema.is(Failure)(v))
}`,
		Effect: `const Failure = Schema.Struct({ cause: Schema.mutableKey(Schema.Defect().pipe(Schema.refine((u) => u instanceof Error))) })
function witness() {
  const probes = [{ cause: new Error("x") }, { cause: new TypeError("t") }, { cause: { message: "x" } }, { cause: "x" }, {}]
  return probes.map((v) => Schema.is(Failure)(v))
}`,
		Cite: Citation{VIP: 44, Template: "Schema.Defect().pipe(Schema.refine(", Quote: "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do."},
	})
}
