import { Effect, Stream } from "effect"
export function forIn():readonly number[]{const reads:(()=>number)[]=[];const head=0;for(const key in {a:1,b:1}){let n=head;reads.push(()=>n);n++}return reads.map(f=>f())}
export function forOf():readonly number[]{const reads:(()=>number)[]=[];const head=0;for(const v of [1,2]){let n=head;reads.push(()=>n);n+=v}return reads.map(f=>f())}
export async function forAwait():Promise<readonly number[]>{const reads:(()=>number)[]=[];const head=0;for await(const v of [1,2]){let n=head;reads.push(()=>n);n+=v}return reads.map(f=>f())}
export function forConcurrent():Effect.Effect<readonly number[]>{return Effect.gen(function*(){const reads:(()=>number)[]=[];const head=0;yield* Effect.forEach([1,2],v=>Effect.sync(()=>{let n=head;reads.push(()=>n);n+=v}),{concurrency:2});return reads.map(f=>f()).sort()})}
export function forTry():Effect.Effect<readonly number[]>{return Effect.gen(function*(){const reads:(()=>number)[]=[];const head=0;yield* Stream.runForEach(Stream.make(1,2),v=>Effect.sync(()=>{let n=head;reads.push(()=>n);n+=v}));return reads.map(f=>f())})}
export function skipped():readonly string[]{const seen:string[]=[];for(const v of [1,2]){try{
 // Intentional checking bypass: the unreachable declaration keeps its cell in TDZ.
 // @ts-ignore TS2448 TS2454
 seen.push(String(n))
}catch(e){seen.push(e instanceof ReferenceError?"tdz":"other")}continue;let n:number=0}return seen}
export function main():Effect.Effect<readonly unknown[]>{return Effect.gen(function*(){return [forIn(),forOf(),yield* Effect.promise(()=>forAwait()),yield* forConcurrent(),yield* forTry(),skipped()]})}
