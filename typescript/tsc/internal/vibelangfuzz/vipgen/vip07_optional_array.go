package vipgen

import "fmt"

// Chapter 004 leaves absent optional list bindings uninitialized.
func init() {
	file := ChapterWitnessFile{
		Name:   "native-optional-array-cell.ts",
		Source: "/** @throws {never} */\nexport function optionalArrayRead(read:()=>unknown){try{const value=read();return [\"value\",typeof value,String(value)]}catch(error){return [\"tdz\",error instanceof ReferenceError]}}\n",
		Names:  []string{"optionalArrayRead"},
	}
	for _, keyword := range []string{"let", "const"} {
		for i, value := range []string{"[]", "[undefined]", "[2]", "[\"x\"]"} {
			key := fmt.Sprintf("vip07.optional-array-cell-%s-%d-plain", keyword, i)
			registerWitness(7, ChapterWitness{
				Key: key, Chapter: "004-match.md", Modules: []string{},
				Quote:  "An absent optional element consumes zero values, leaves the iterator done and the actual index unchanged, and does not run its sub-pattern or initialize its bindings.",
				Vibe:   "function witness(){const value:readonly unknown[]=" + value + ";return match(value){when [" + keyword + " cell?]:optionalArrayRead(()=>cell);default:\"miss\";}}",
				Effect: "function witness(){const value=" + value + ";const read=()=>cell;if(value.length===0)return optionalArrayRead(read);" + keyword + " cell=value[0];return optionalArrayRead(read)}",
				Cite:   vip7Cite("return"), Files: []ChapterWitnessFile{file},
			})
			Lookup(key).Citations[0].Reading = ""
		}
	}
}
