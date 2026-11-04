package vipgen

func init() {
	for _, row := range []struct{ key, source, native, call string }{
		{"default", "effect function* f(x: number = 7) { yield x }", "function f(x = 7) { return values(x) }", "f()"},
		{"prefix", "effect function* f(a: number, x: number = 7) { yield a + x }", "function f(a, x = 7) { return values(a + x) }", "f(3)"},
		{"object", "effect function* f({x}: {x:number} = {x:7}) { yield x }", "function f({x} = {x:7}) { return values(x) }", "f({x:9})"},
		{"rest", "const f = effect function*(x: number = 7, ...tail: number[]) { yield x + tail.length }", "const f = function(x = 7, ...tail) { return values(x + tail.length) }", "f(5,1,2)"},
		{"method", "const f = { effect *run(x: number = 7) { yield x } }.run", "const f = { run(x = 7) { return values(x) } }.run", "f(9)"},
		{"array", "effect function* f([x]: number[] = [7]) { yield x }", "function f([x] = [7]) { return values(x) }", "f()"},
	} {
		hostile := "true"
		if row.key == "array" {
			hostile = "false"
		}
		common := "const a=observe(() => " + row.call + ",false); const b=observe(() => " + row.call + "," + hostile + ");"
		registerWitness(21, ChapterWitness{
			Key:      "vip21.parameter-forwarding-" + row.key,
			Chapter:  "001-functions.md",
			Quote:    "Parameters, defaults included, are bound when the function is called, before `Effect.gen`, as an `async` function's are bound before its body starts.",
			Cite:     Citation{VIP: 21, Template: "function f(‹parameters›)", Quote: "It compiles to Effect's `Stream.callback` with one element of buffer."},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Modules:  []string{"Stream", "Queue"},
			Files:    []ChapterWitnessFile{{Name: "producer-forwarding.ts", Source: producerForwardingObserver, Names: []string{"observe"}}},
			Vibe:     "effect function witness() { " + row.source + "; " + common + " return [[a.reads,a.steps],[b.reads,b.steps],try Stream.runCollect(a.program),try Stream.runCollect(a.program),try Stream.runCollect(b.program)]; }",
			Effect:   "function witness() { function values(x) { return Stream.callback(queue => Effect.gen(function* () { yield* Queue.offer(queue,x) }).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:'suspend'}); } " + row.native + "; return Effect.gen(function* () { " + common + " return [[a.reads,a.steps],[b.reads,b.steps],yield* Stream.runCollect(a.program),yield* Stream.runCollect(a.program),yield* Stream.runCollect(b.program)]; }); }",
		})
	}
}

const producerForwardingObserver = `/** @throws {never} */
export function observe<A>(call: () => A, hostile: boolean) {
 const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!
 const proto = Object.getPrototypeOf([][Symbol.iterator]())
 const next = Object.getOwnPropertyDescriptor(proto, "next")!
 let reads=0, steps=0
 const problem={hostile:true}
 Object.defineProperty(Array.prototype, Symbol.iterator, {configurable:true,get(){reads++;if(hostile)throw problem;return iterator.value}})
 Object.defineProperty(proto, "next", {...next,value:function(this:unknown){steps++;if(hostile)throw problem;return Reflect.apply(next.value,this,[])}})
 try {const program=call();return {program,reads,steps}}
 finally {
  Object.defineProperty(Array.prototype,Symbol.iterator,iterator)
  Object.defineProperty(proto,"next",next)
 }
}
`
