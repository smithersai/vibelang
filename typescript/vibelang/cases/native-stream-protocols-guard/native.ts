import {Stream} from "effect"
export type Dual=Stream.Stream<number>&Iterable<number>&AsyncIterable<number>
let made=0,syncClosed=0,asyncClosed=0
export function make():Dual {
 made++
 return Object.assign(Stream.make(1),{
  *[Symbol.iterator](){try{yield 2;yield 20}finally{syncClosed++}},
  async *[Symbol.asyncIterator](){try{yield 3;yield 30}finally{asyncClosed++}}
 })
}
export function counts(){return [made,syncClosed,asyncClosed]}
