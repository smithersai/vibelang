package vibelangfuzz

import (
	"fmt"
	"maps"
)

// Each pair is a hand-written spelling of the same program from the cited
// rule, rather than the fixer output or a recovery emit of invalid syntax.
type quickfixGolden struct{ before, reference string }

func quickfixGoldenPrograms() map[int32]quickfixGolden {
	return map[int32]quickfixGolden{
		501:  {before: "export function main() { return try Effect.succeed(7) }\n", reference: "export effect function main() { return try Effect.succeed(7) }\n"},
		1401: {before: "const value=Utils\nexport function main(){return typeof value}\n", reference: "import {Utils} from \"effect\"\nconst value=Utils\nexport function main(){return typeof value}\n"},
		1703: {before: "export effect function main() { const task=fork (Effect.fail(\"oops\") catch () => 7); return join task }\n", reference: "export effect function main() { const task=fork (effect {return Effect.fail(\"oops\") catch () => 7}); return join task }\n"},
		1801: {before: "export effect function main() { return try.all {value:Effect.succeed(7)} }\n", reference: "export effect function main() { return try Effect.all({value:Effect.succeed(7)},{concurrency:\"unbounded\"}) }\n"},
		4853: {before: "service Users {readonly value:number}\neffect function read():number!never {return (try Users).value}\nexport effect function main(){provide Layer.succeed(Users,{value:7}) {return try read()}}\n", reference: "service Users {readonly value:number}\neffect function read():number!never!Users {return (try Users).value}\nexport effect function main(){provide Layer.succeed(Users,{value:7}) {return try read()}}\n"},
		107:  {before: "export function main():number {return match(7){when var value:value;}}\n", reference: "export function main():number {return match(7){when let value:value;}}\n"},
		301:  {before: "export type Result=string | number!Error\nexport function main(){return 7}\n", reference: "export type Result=(string | number)!Error\nexport function main(){return 7}\n"},
		908:  {before: "service Users {a:number b:string}\nexport effect function main(){provide Layer.succeed(Users,{a:7,b:\"x\"}) {return (try Users).a}}\n", reference: "service Users {a:number; b:string}\nexport effect function main(){provide Layer.succeed(Users,{a:7,b:\"x\"}) {return (try Users).a}}\n"},
		1306: {before: "export error E {a:number b:string}\nexport function main(){return new E({a:7,b:\"x\"}).a}\n", reference: "export error E {a:number; b:string}\nexport function main(){return new E({a:7,b:\"x\"}).a}\n"},
		1605: {before: "export data Pair {Value {x:number y:string}}\nexport function main(){return Pair.Value({x:7,y:\"x\"}).x}\n", reference: "export data Pair {Value {x:number; y:string}}\nexport function main(){return Pair.Value({x:7,y:\"x\"}).x}\n"},
		102:  {before: "export effect function main() { const task = try Effect.forkChild(Effect.succeed(7)); return await task }\n", reference: "export effect function main() { const task = try Effect.forkChild(Effect.succeed(7)); return join task }\n"},
		510:  {before: "export effect function main() { return try Effect.succeed(7) ** 2 }\n", reference: "export effect function main() { return (try Effect.succeed(7)) ** 2 }\n"},
		1301: {before: "export error E { value: string; constructor() { super({value: \"x\"}) } }\nexport function main() { return new E().value }\n", reference: "export class E extends Data.TaggedError(\"E\")<{readonly value: string}> { constructor() { super({value: \"x\"}) } }\nexport function main() { return new E().value }\n"},
		1302: {before: "export error E { set value(x: number) {} }\nexport function main() { const e = new E(); e.value = 7; return e._tag }\n", reference: "export class E extends Data.TaggedError(\"E\")<{}> { set value(x: number) {} }\nexport function main() { const e = new E(); e.value = 7; return e._tag }\n"},
		1303: {before: "export error E<T> { value: T }\nexport function main() { return new E({value: 7}).value }\n", reference: "export class E<T> extends Data.TaggedError(\"E\")<{readonly value:T}> {}\nexport function main() { return new E({value: 7}).value }\n"},
		2803: {before: "data Box<A=number> { Value {value:A} }\nexport function main() { return Box.Value({value:7}).value }\n", reference: "data Box<A> { Value {value:A} }\nexport function main() { return Box.Value({value:7}).value }\n"},
		3007: {before: "service Fn: (n: number) => number\nexport effect function main() { provide Layer.succeed(Fn, (n: number) => n+1) { return Fn(6) } }\n", reference: "service Fn: (n: number) => number\nexport effect function main() { provide Layer.succeed(Fn, (n: number) => n+1) { return (try Fn)(6) } }\n"},
		4405: {before: "export effect function main() { const x=7; return try sync(() => x+1) }\n", reference: "export effect function main() { const x=7; return try sync((value:number) => value+1,x) }\n"},
		4813: {before: "export function main() { return Effect.catchAll(Effect.fail(\"oops\"), () => Effect.succeed(7)) }\n", reference: "export function main() { return Effect.catch(Effect.fail(\"oops\"), () => Effect.succeed(7)) }\n"},
		1702: {before: "export effect function main() { const fork = 7; return fork }\n", reference: "export effect function main() { const value = 7; return value }\n"},
		106:  {before: "export effect function main(): number { return 7 }\n", reference: "export effect function main(): number!! { return 7 }\n"},
		109:  {before: "const typed = effect n: number => n\nexport function main() { return typed(7) }\n", reference: "const typed = effect (n: number) => n\nexport function main() { return typed(7) }\n"},
		509:  {before: "const handler = (_: unknown) => 7\nexport effect function main() { return Effect.fail(1) catch handler }\n", reference: "const handler = (_: unknown) => 7\nexport effect function main() { return Effect.fail(1) catch (e) => handler(e) }\n"},
		1002: {before: "import * as Effect from \"effect/Effect\"\nexport function main() { return Effect.gen(function* () { return yield* Effect.succeed(7) }) }\n", reference: "import * as Effect from \"effect/Effect\"\nexport function main() { return Effect.succeed(7) }\n"},
		1101: {before: "function call(f: () => number) { return f() }\nexport function main() { return call() { return 7 } }\n", reference: "function call(f: () => number) { return f() }\nexport function main() { return call(() => 7) }\n"},
		1202: {before: "export effect function main() { provide Layer.empty,\n Layer.empty { return 7 } }\n", reference: "export effect function main() { provide Layer.empty, Layer.empty { return 7 } }\n"},
		1304: {before: "interface Shape {}\nexport error E implements Shape {}\nexport function main() { return new E()._tag }\n", reference: "interface Shape {}\nexport error E {}\nexport function main() { return new E()._tag }\n"},
		1307: {before: "declare error E { value: string }\nexport function main() { return 7 }\n", reference: "export function main() { return 7 }\n"},
		1802: {before: "export effect function main() { return await.race [Effect.succeed(7), Effect.succeed(8)] }\n", reference: "export effect function main() { return try.race [Effect.succeed(7), Effect.succeed(8)] }\n"},
		4616: {before: "error Bad { cause: unknown }\nexport effect function main() { return try((n: number) => n + 1, (cause) => new Bad({cause}), 6) }\n", reference: "error Bad { cause: unknown }\nexport effect function main() { return try Effect.try({ try: () => ((n: number) => n + 1)(6), catch: (cause) => new Bad({cause}) }) }\n"},

		701: {
			before:    "export function main() { return match (true) { when true: 7\n default: 8; } }\n",
			reference: "export function main() { return match (true) { when true: 7; default: 8; } }\n",
		},
		1013: {
			before:    "data Point { Here { x: number, y: number } }\nexport function main() { const p = Point.Here({x: 7, y: 8}); return [p.x, p.y] }\n",
			reference: "data Point { Here { x: number; y: number } }\nexport function main() { const p = Point.Here({x: 7, y: 8}); return [p.x, p.y] }\n",
		},
		4618: {
			before:    "effect double(n: number) { return n * 2 }\nexport effect function main() { return try double(7) }\n",
			reference: "effect function double(n: number) { return n * 2 }\nexport effect function main() { return try double(7) }\n",
		},
		4823: {
			before:    "// @vibelang-diagnostics EK4823:warning\nconst increment = (n: number) => { return n + 1 }\nexport function main() { return increment(7) }\n",
			reference: "// @vibelang-diagnostics EK4823:warning\nconst increment = (n: number) => n + 1\nexport function main() { return increment(7) }\n",
		},
		4824: {
			before:    "// @vibelang-diagnostics EK4824:warning\nexport function main() { return pipe(7) }\n",
			reference: "export function main() { return 7 }\n",
		},
		4825: {
			before:    "// @vibelang-diagnostics EK4825:warning\nexport function main() { return Option.some(7).pipe(Option.map((n: number) => n + 1)).pipe(Option.getOrElse(() => 0)) }\n",
			reference: "export function main() { return Option.getOrElse(Option.map(Option.some(7), (n: number) => n + 1), () => 0) }\n",
		},
	}
}

func quickfixGoldenReference(key string, files map[string]string) map[string]string {
	var code int32
	if _, err := fmt.Sscanf(key, "EK%d", &code); err != nil {
		return nil
	}
	seed, ok := quickfixGoldenPrograms()[code]
	if !ok {
		return nil
	}
	ref := maps.Clone(files)
	ref[toolsMainFile(ref)] = seed.reference
	return ref
}

func quickfixInstallGoldenPrograms(seeds map[int32][]Seed) {
	for code, pair := range quickfixGoldenPrograms() {
		name := fmt.Sprintf("EK%04d-runtime", code)
		seeds[code] = []Seed{{Name: name, Files: map[string]string{"main.vibe": pair.before}}}
	}
}
