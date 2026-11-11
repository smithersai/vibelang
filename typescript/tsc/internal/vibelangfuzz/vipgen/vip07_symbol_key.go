package vipgen

func init() {
	registerWitness(7, ChapterWitness{
		Key:     "vip07.symbol-key-lexical-bindings-plain",
		Chapter: "004-match.md",
		Quote:   "`Symbol.customMatcher` has the same unique symbol type as the runtime's `customMatcher` export.",
		Vibe:    `function witness():unknown[]{const protocol=Symbol.customMatcher;const local=Symbol("local");let reads=0;const holder={get customMatcher(){reads++;return local}};function parameter(Symbol:{readonly customMatcher:symbol}):boolean{return Symbol.customMatcher===local}const arrow=(Symbol:{readonly customMatcher:symbol}):boolean=>Symbol.customMatcher===local;const reader={read(Symbol:{readonly customMatcher:symbol}):boolean{return Symbol.customMatcher===local}};function destructured({Symbol}:{Symbol:{readonly customMatcher:symbol}}):boolean{return Symbol.customMatcher===local}return [typeof protocol==="symbol",parameter(holder),arrow(holder),reader.read(holder),destructured({Symbol:holder}),reads]}`,
		Effect:  `function witness(){const protocol=Symbol.customMatcher??Symbol.for("Symbol.customMatcher");const local=Symbol("local");let reads=0;const holder={get customMatcher(){reads++;return local}};function parameter(Symbol){return Symbol.customMatcher===local}const arrow=(Symbol)=>Symbol.customMatcher===local;const reader={read(Symbol){return Symbol.customMatcher===local}};function destructured({Symbol}){return Symbol.customMatcher===local}return [typeof protocol==="symbol",parameter(holder),arrow(holder),reader.read(holder),destructured({Symbol:holder}),reads]}`,
		Modules: []string{},
		Cite:    vip7Cite("Symbol.customMatcher??Symbol.for(\"Symbol.customMatcher\")"),
	})
}
