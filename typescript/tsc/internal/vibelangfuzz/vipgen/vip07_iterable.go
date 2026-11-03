package vipgen

import "fmt"

// VIP-7's cached iterator admission and VIP-31's native generator abandonment.
func init() {
	file := ChapterWitnessFile{
		Name:   "native-cache-iterable.ts",
		Source: "/** @throws {never} */\nexport function items(log:string[]):Generator<number>{return (function*(){try{log.push(\"start\");yield 1;log.push(\"second\");yield 2}finally{log.push(\"close\")}})()}\n",
		Names:  []string{"items"},
	}
	registerVIP7IterableWitness(ChapterWitness{
		Key: "vip07.iterable-cache-arm-prefixes-plain", Chapter: "004-match.md",
		Quote:  "Later arms reuse them: a cached pattern getter runs at most once and an iterable subject is iterated once.",
		Vibe:   "function witness(){const log:string[]=[];const value=match(items(log)){when [9,...]:0;when [let a,let b]:a+b;default:-1;};return [value,log]}",
		Effect: "function witness(){const log=[];const xs=[...items(log)];return [xs.length===2?xs[0]+xs[1]:-1,log]}",
		Cite:   vip7Cite("return"), Files: []ChapterWitnessFile{file},
	})
	registerVIP7IterableWitness(ChapterWitness{
		Key: "vip07.iterable-cache-short-circuit-plain", Chapter: "004-match.md",
		Quote:  "However a `match` or an `is` test ends, `FinishMatch` closes every unfinished cached iterator",
		Vibe:   "function witness(){const log:string[]=[];const yes=items(log) is [9,...];return [yes,log]}",
		Effect: "function witness(){const log=[];let yes=false;for(const x of items(log)){yes=x===9;break}return [yes,log]}",
		Cite:   vip7Cite("return"), Files: []ChapterWitnessFile{file},
	})
	registerVIP7IterableWitness(ChapterWitness{
		Key: "vip07.iterable-cache-primitives-plain", Chapter: "004-match.md",
		Quote:  "Other subjects use cached `Symbol.iterator` lookup with `GetV` semantics: retain the original subject as receiver for both an inherited getter and the iterator call, including primitive strings.",
		Vibe:   "function pair(s:unknown){return s is [\"a\",\"b\"]}function empty(s:unknown){return s is []}function witness(){return [pair(\"ab\"),new Set([1,2]) is [1,2],empty(null),empty(undefined),empty(7)]}",
		Effect: "function witness(){return [[...\"ab\"].join(\"\")===\"ab\",[...new Set([1,2])].join()===\"1,2\",false,false,false]}",
		Cite:   vip7Cite("return"),
	})
	for _, mode := range []string{"fail", "die", "interrupt"} {
		operand := "Effect." + mode + "(\"bad\")"
		if mode == "interrupt" {
			operand = "Effect.interrupt"
		}
		for _, shape := range []string{"binding", "assignment", "loop"} {
			tail := "return x"
			vibePattern := "const [x=try " + operand + "]=holes(log);"
			nativePattern := "const [x=yield* " + operand + "]=holes(log);"
			if shape == "assignment" {
				vibePattern = "let x:unknown;[x=try " + operand + "]=holes(log);"
				nativePattern = "let x;[x=yield* " + operand + "]=holes(log);"
			}
			if shape == "loop" {
				tail = ""
				vibePattern = "for(const outer of [0]){" + vibePattern + "return x}return 0;"
				nativePattern = "for(const outer of [0]){" + nativePattern + "return x}return 0;"
			}
			key := fmt.Sprintf("vip07.iterable-default-%s-%s-plain", shape, mode)
			registerVIP7IterableWitness(ChapterWitness{
				Key: key, Chapter: "008-runtime.md",
				Quote:  "So when a `yield*` in effect code fails, dies or is interrupted, no JavaScript after it runs: no `using` disposal, no destructuring `IteratorClose`, no `FinishMatch`.",
				Vibe:   "effect function f(log:string[]){" + vibePattern + tail + "}function witness(){const log:string[]=[];return [Effect.runSyncExit(f(log)),log]}",
				Effect: "function f(log){return Effect.gen(function*(){" + nativePattern + tail + "})}function witness(){const log=[];return [Effect.runSyncExit(f(log)),log]}",
				Cite:   vip7Cite("return"), Files: []ChapterWitnessFile{{
					Name:   "native-default-holes.ts",
					Source: "/** @throws {never} */\nexport function holes(log:string[]){return(function*(){try{log.push(\"start\");yield undefined;yield 2}finally{log.push(\"close\")}})()}\n",
					Names:  []string{"holes"},
				}},
			})
		}
	}
}

// VIP-7 includes the return template directly. The chapter quotes above still
// supply each witness's oracle; these new citations need no prose reading.
func registerVIP7IterableWitness(w ChapterWitness) {
	registerWitness(7, w)
	Lookup(w.Key).Citations[0].Reading = ""
}
