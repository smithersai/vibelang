// Chapter 900: cov900-native-option-match — independent Effect reference.
import {Effect,Option} from "effect"
const value=Option.some(1)
const result=Option.match(value,{onNone:()=>0,onSome:n=>n})
export function main(){return Effect.gen(function*(){return [result]})}
