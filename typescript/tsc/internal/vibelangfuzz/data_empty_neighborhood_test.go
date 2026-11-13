package vibelangfuzz

// VIP-16/detail25: zero variants remain never across declaration homes.
func emptyDataNeighborhoodRules() []dataRule {
	const quote = "Zero variants are allowed"
	return []dataRule{
		{"empty-data-exported", "006-data.md", quote, "export data E {}; const n:never=null as unknown as E", ""},
		{"empty-data-contextual-as", "006-data.md", quote, "export data as {}; const n:never=null as unknown as as", ""},
		{"empty-data-namespace", "006-data.md", quote, "namespace N {export data E {}}; const n:never=null as unknown as N.E", ""},
		{"empty-data-never-assignment", "006-data.md", quote, "data E {}; const n:E={}", "only:TS2322"},
		{"empty-data-generic-1", "006-data.md", quote, "export data E<A> {}; const n:never=null as unknown as E<number>", ""},
		{"empty-data-generic-2", "006-data.md", quote, "export data E<A,B> {}; const n:never=null as unknown as E<number,string>", ""},
		{"empty-data-generic-3", "006-data.md", quote, "export data E<A,B,C> {}; const n:never=null as unknown as E<number,string,boolean>", ""},
		{"empty-data-generic-4", "006-data.md", quote, "export data E<A,B,C,D> {}; const n:never=null as unknown as E<number,string,boolean,bigint>", ""},
	}
}
