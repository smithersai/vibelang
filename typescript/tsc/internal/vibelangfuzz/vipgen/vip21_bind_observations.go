package vipgen

func init() {
	for _, row := range []struct{ key, source, native string }{
		{"class", "class Counter { n=7; effect *run(){yield this.n} }; const receiver=new Counter(); const make=()=>receiver.run(); const mutate=()=>{receiver.n++}",
			"class Counter { n=7; run(){return values(()=>this.n)} }; const receiver=new Counter(); const make=()=>receiver.run(); const mutate=()=>{receiver.n++}"},
		{"object", "const receiver={n:11,effect *run(){yield this.n}}; const make=()=>receiver.run(); const mutate=()=>{receiver.n++}",
			"const receiver={n:11,run(){return values(()=>this.n)}}; const make=()=>receiver.run(); const mutate=()=>{receiver.n++}"},
		{"static", "class Counter { static n=13; static effect *run(){yield this.n} }; const receiver=Counter; const make=()=>receiver.run(); const mutate=()=>{receiver.n++}",
			"class Counter { static n=13; static run(){return values(()=>this.n)} }; const receiver=Counter; const make=()=>receiver.run(); const mutate=()=>{receiver.n++}"},
		{"private", "class Counter { n=17; effect *#run(){yield this.n}; run(){return this.#run()} }; const receiver=new Counter(); const make=()=>receiver.run(); const mutate=()=>{receiver.n++}",
			"class Counter { n=17; #run(){return values(()=>this.n)}; run(){return this.#run()} }; const receiver=new Counter(); const make=()=>receiver.run(); const mutate=()=>{receiver.n++}"},
		{"expression", "const run=effect function*(this:{n:number}){yield this.n}; const receiver={n:19}; const make=()=>invoke(run,receiver); const mutate=()=>{receiver.n++}",
			"const run=function(){return values(()=>this.n)}; const receiver={n:19}; const make=()=>invoke(run,receiver); const mutate=()=>{receiver.n++}"},
		{"no-receiver", "effect function* run(){yield 23}; const make=()=>run(); const mutate=()=>{}",
			"function run(){return values(()=>23)}; const make=()=>run(); const mutate=()=>{}"},
	} {
		common := "const a=observe(make,false); const b=observe(make,true); mutate();"
		registerWitness(21, ChapterWitness{
			Key:      "vip21.bind-observation-" + row.key,
			Chapter:  "008-runtime.md",
			Quote:    "Compiled output gives the same `Exit` as the accepted VIP’s Effect TypeScript counterpart: success, failure, defect or interruption, with finalizers run in the same order.",
			Cite:     Citation{VIP: 21, Template: "function values(‹callback›)", Quote: "It compiles to Effect's `Stream.callback` with one element of buffer."},
			Requires: []string{"vip01.effect-function", "vip05.try"},
			Modules:  []string{"Stream", "Queue"},
			Files:    []ChapterWitnessFile{{Name: "producer-bind.ts", Source: producerBindObserver, Names: []string{"observe", "invoke"}}},
			Vibe:     "effect function witness() { " + row.source + "; " + common + " return [a.reads,b.reads,try Stream.runCollect(a.program),try Stream.runCollect(a.program),try Stream.runCollect(b.program)]; }",
			Effect:   "function witness() { function values(x) { return Stream.callback(queue => Effect.gen(function* () { yield* Queue.offer(queue,x()) }).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:'suspend'}); } " + row.native + "; return Effect.gen(function* () { " + common + " return [a.reads,b.reads,yield* Stream.runCollect(a.program),yield* Stream.runCollect(a.program),yield* Stream.runCollect(b.program)]; }); }",
		})
	}
}

const producerBindObserver = `/** @throws {never} */
export function observe<A>(make:()=>A,hostile:boolean) {
 const old=Object.getOwnPropertyDescriptor(Function.prototype,"bind")!
 let reads=0
 const problem={hostile:true}
 Object.defineProperty(Function.prototype,"bind",{configurable:true,get(){reads++;if(hostile)throw problem;return old.value}})
 try {const program=make();return {program,reads}}
 finally {Object.defineProperty(Function.prototype,"bind",old)}
}
/** @throws {never} */
export function invoke<A>(f:()=>A,self:unknown):A {return Reflect.apply(f,self,[])}
`
