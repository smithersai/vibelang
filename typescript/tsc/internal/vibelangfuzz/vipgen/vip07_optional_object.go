package vipgen

import (
	"fmt"
	"strings"
)

// Optional property bindings initialize only when the property is present.
func init() {
	file := ChapterWitnessFile{
		Name:   "native-optional-object-cell.ts",
		Source: "/** @throws {never} */\nexport function optionalObjectRead(read:()=>unknown){try{const value=read();return [\"value\",typeof value,String(value)]}catch(error){return [\"tdz\",error instanceof ReferenceError]}}\n",
		Names:  []string{"optionalObjectRead"},
	}
	for _, keyword := range []string{"let", "const"} {
		for i, value := range []string{"{}", "{cell:undefined}", "{cell:2}", "{cell:\"x\"}"} {
			key := fmt.Sprintf("vip07.optional-object-cell-%s-%d-plain", keyword, i)
			registerWitness(7, ChapterWitness{
				Key: key, Chapter: "004-match.md", Modules: []string{},
				Quote:  "Each cell stays in TDZ until its binding pattern executes.",
				Vibe:   "function witness(){const value:{cell?:unknown}=" + value + ";return match(value){when {" + keyword + " cell?}:optionalObjectRead(()=>cell);default:\"miss\";}}",
				Effect: "function witness(){const value=" + value + ";const read=()=>cell;if(!(\"cell\" in value))return optionalObjectRead(read);" + keyword + " cell=value.cell;return optionalObjectRead(read)}",
				Cite:   vip7Cite("const read=()=>cell;if(!(\"cell\" in value))"), Files: []ChapterWitnessFile{file},
			})
		}
	}
	for _, keyword := range []string{"let", "const"} {
		for _, row := range []struct{ name, value string }{
			{"prototype", "Object.create({ cell: 2 })"},
			{"inherited-getter", "Object.assign(Object.create({ value: 2, get cell() { reads++; return (this as { value: number }).value } }), { value: 7 })"},
			{"own-getter", "({ get cell() { reads++; return 2 } })"},
			{"own-getter-undefined", "({ get cell() { reads++; return undefined } })"},
		} {
			key := fmt.Sprintf("vip07.optional-object-neighbor-%s-%s-plain", keyword, row.name)
			nativeValue := strings.ReplaceAll(row.value, "(this as { value: number }).value", "this.value")
			registerWitness(7, ChapterWitness{
				Key: key, Chapter: "004-match.md",
				Quote:  "Later arms reuse them: a cached pattern getter runs at most once and an iterable subject is iterated once.",
				Vibe:   "function witness(){let reads=0;const value:{cell?:unknown}=" + row.value + ";const result=match(value){when {" + keyword + " cell?}:optionalObjectRead(()=>cell);default:[\"miss\"];};return [result,reads]}",
				Effect: "function witness(){let reads=0;const value=" + nativeValue + ";const read=()=>cell;if(!(\"cell\" in value))return [optionalObjectRead(read),reads];" + keyword + " cell=value.cell;return [optionalObjectRead(read),reads]}",
				Cite:   vip7Cite("const read=()=>cell;if(!(\"cell\" in value))"), Files: []ChapterWitnessFile{file},
			})
		}
	}

}
