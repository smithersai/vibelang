package vibelangfuzz

import (
	"testing"
)

func TestErrorClassMatcherFixQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeErrorClassFixQuote)
	chapterSays(t, "004-match.md", "It returns `[subject]` on a match and `false` otherwise")
}

const errorClassMatcherFixProbe = "import {Effect} from \"effect\"\nexport function main(){\n const key=(Symbol as any).customMatcher ?? Symbol.for(\"Symbol.customMatcher\")\n const copy:unknown={_tag:\"E\"}\n if(!Object.hasOwn(E,key))return Effect.succeed([\"missing-own\"])\n const method=Reflect.get(E,key)\n const result=Reflect.apply(method,undefined,[copy,{matchType:\"extractor\"}])\n function matches(value:unknown){return match(value){when E:true;default:false;}}\n const before=matches(copy)\n Reflect.deleteProperty(E,key)\n const removed=matches(copy)\n Reflect.defineProperty(E,key,{value:method,writable:true,configurable:true})\n return Effect.succeed([Object.hasOwn(E,key),Array.isArray(result)&&result[0]===copy,before,removed,matches(copy)])\n}\n"
