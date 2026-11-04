package vipgen

import "fmt"

// Chapter 004 applies optional argument positions to extractor result lists.
func init() {
	file := ChapterWitnessFile{
		Name:   "native-optional-extractor-cell.ts",
		Source: "/** @throws {never} */\nexport function optionalExtractorRead(read:()=>unknown){try{const value=read();return [\"value\",typeof value,String(value)]}catch(error){return [\"tdz\",error instanceof ReferenceError]}}\n",
		Names:  []string{"optionalExtractorRead"},
	}
	for _, keyword := range []string{"let", "const"} {
		for i, value := range []string{"Option.none()", "Option.some(undefined)", "Option.some(2)", "Option.some(\"x\")"} {
			key := fmt.Sprintf("vip07.optional-extractor-cell-%s-%d-plain", keyword, i)
			registerWitness(7, ChapterWitness{
				Key: key, Chapter: "004-match.md", Modules: []string{"Option"},
				Quote:  "An absent optional element consumes zero values, leaves the iterator done and the actual index unchanged, and does not run its sub-pattern or initialize its bindings.",
				Vibe:   "function witness(){const value:Option.Option<unknown>=" + value + ";return match(value){when Option.None(" + keyword + " cell?):optionalExtractorRead(()=>cell);when Option.Some(" + keyword + " cell?):optionalExtractorRead(()=>cell);default:\"miss\";}}",
				Effect: "function witness(){const value=" + value + ";const read=()=>cell;if(Option.isNone(value))return optionalExtractorRead(read);" + keyword + " cell=value.value;return optionalExtractorRead(read)}",
				Cite:   vip7Cite("return"), Files: []ChapterWitnessFile{file},
			})
			Lookup(key).Citations[0].Reading = ""
		}
	}
}
