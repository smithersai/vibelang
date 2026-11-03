import {Effect} from "effect"
class Point {value=1}
const point={constructor:Point}
const opaque:any=()=>1
export function main(){return Effect.gen(function*(){return [new point.constructor().value,typeof opaque.constructor]})}
