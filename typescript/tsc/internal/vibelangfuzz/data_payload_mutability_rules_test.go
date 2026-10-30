package vibelangfuzz

// VIP-16: TaggedEnum makes only variant keys readonly; payload types keep native mutability.
func dataPayloadMutabilityRules() []dataRule {
	const quote = "A data payload is emitted as a TypeScript type literal"
	return []dataRule{
		{"data-payload-nested-object", "006-data.md", quote, "data P { V { nested: { count: number } } }; declare const p:P; p.nested.count=1", "", "impl-hunt-data"},
		{"data-payload-nested-index", "006-data.md", quote, "data P { V { nested: { [key:string]:number } } }; declare const p:P; p.nested[\"count\"]=1", "", "impl-hunt-data"},
		{"data-payload-nested-array", "006-data.md", quote, "data P { V { items: { count:number }[] } }; declare const p:P; p.items[0].count=1", "", "impl-hunt-data"},
		{"data-payload-nested-tuple", "006-data.md", quote, "data P { V { items: [{count:number}] } }; declare const p:P; p.items[0].count=1", "", "impl-hunt-data"},
		{"data-payload-nested-deep", "006-data.md", quote, "data P { V { item: { nested: {count:number} } } }; declare const p:P; p.item.nested.count=1", "", "impl-hunt-data"},
		{"data-payload-nested-generic", "006-data.md", quote, "data P<A> { V { item: {value:A} } }; declare const p:P<number>; p.item.value=1", "", "impl-hunt-data"},
		{"data-payload-nested-readonly-array-element", "006-data.md", quote, "data P { V { items: readonly {count:number}[] } }; declare const p:P; p.items[0].count=1", "", "impl-hunt-data"},
		{"data-payload-nested-callback", "006-data.md", quote, "data P { V { consume: (item:{count:number})=>void } }; const consume:P[\"consume\"] = item=>{item.count=1}", "", "impl-hunt-data"},
		{"data-payload-explicit-readonly-property", "006-data.md", quote, "data P { V { item: {readonly count:number} } }; declare const p:P; p.item.count=1", "only:TS2540", "impl-hunt-data"},
		{"data-payload-explicit-readonly-index", "006-data.md", quote, "data P { V { item: {readonly [key:string]:number} } }; declare const p:P; p.item[\"count\"]=1", "only:TS2542", "impl-hunt-data"},
		{"data-payload-outer-readonly-property", "006-data.md", quote, "data P { V { item: {count:number} } }; declare const p:P; p.item={count:1}", "only:TS2540", "impl-hunt-data"},
		{"data-payload-explicit-readonly-array", "006-data.md", quote, "data P { V { items: readonly number[] } }; declare const p:P; p.items[0]=1", "only:TS2542", "impl-hunt-data"},
	}
}
