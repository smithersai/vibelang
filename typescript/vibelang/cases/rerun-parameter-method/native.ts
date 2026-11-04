import { Effect } from "effect"

// Chapter001: parameters bind when this wrapper is called. Each generator
// execution shares those bindings and reads its receiver's current state.
export class Counter {
  constructor(readonly offset: number) {}
  compact(n: number): Effect.Effect<number> {
    const self=this
    return Effect.gen(function*(){return ++n+self.offset})
  }
  expanded(n: number): Effect.Effect<number> {
    const self=this
    return Effect.gen(function*(){const result=++n;return result+self.offset})
  }
  static compound(n: number): Effect.Effect<number> {
    return Effect.gen(function*(){n+=1;return n})
  }
  assignment(n: number): Effect.Effect<number> {
    const self=this
    return Effect.gen(function*(){n=n+1;return n+self.offset})
  }
  destructured({n}:{n:number}): Effect.Effect<number> {
    return Effect.gen(function*(){const result=++n;return result})
  }
  redeclared(n: number): Effect.Effect<number> {
    return Effect.gen(function*(){n=n+1;return n})
  }
  argumentsRead(...args:[number]): Effect.Effect<number> {
    return Effect.gen(function*(){let[n]=args;n+=1;return n+args.length})
  }
  #increment(n:number): Effect.Effect<number> {
    return Effect.gen(function*(){return ++n})
  }
  get operation(){return this.#increment}
  privateRead(n:number): Effect.Effect<number> {
    const self=this
    return Effect.gen(function*(){return yield* self.#increment(n)})
  }
  loop(n:number): Effect.Effect<number> {
    return Effect.gen(function*(){let before=n;for(n of [2]){};return before+n})
  }
}
export const object={
  read(n:number):Effect.Effect<number>{
    return Effect.gen(function*(){const result=++n;return result})
  }
}
export const nested=(n:number)=>Effect.gen(function*(){return [0].map(()=>++n)[0]!})
export const destructuringAssignment=(n:number)=>Effect.gen(function*(){return ([n]=[n+1],n)})
export const objectAssignment=(n:number)=>Effect.gen(function*(){return ({n}={n:n+1},n)})
export const postfix=(n:number)=>Effect.gen(function*(){return n++})
export const logical=(n:number)=>Effect.gen(function*(){return (n ||= 2,n++)})
export class Base {
  read(n:number):Effect.Effect<number>{return Effect.gen(function*(){return n})}
}
export class Derived extends Base {
  read(n:number):Effect.Effect<number>{
    const readBase=(value:number)=>super.read(value)
    return Effect.gen(function*(){n+=1;return yield* readBase(n)})
  }
}
