import { Effect } from "effect"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
export function ordinary(s:Date|{kind:string}) {if(!(s instanceof Date))return s.kind;return s.getUTCFullYear()}
export function literal(s:"a"|"b"|null|undefined):"b"|"other" {if(!(s==="a"||s===null||s===undefined))return s;return "other"}
export function predicate(s:string|number) {const p=(x:string|number):x is string=>typeof x==="string";if(!p(s))return s.toFixed(1);return s.toUpperCase()}
export function opaque(s:string|number):string|number {const p=(x:unknown):boolean=>typeof x==="string";if(!p(s)){const a:typeof s=1;const b:typeof s="x";return s}const a:typeof s=1;const b:typeof s="x";return s}
export function own(s:string|number):string|number {class C{static [customMatcher](x:unknown):boolean{return typeof x==="string"}};if(!C[customMatcher](s)){const a:typeof s=1;const b:typeof s="x";return s}const a:typeof s=1;const b:typeof s="x";return s}
export function main():Effect.Effect<readonly unknown[]> { return Effect.sync(()=>[ordinary(new Date(0)),ordinary({kind:"k"}),literal("a"),literal("b"),literal(null),literal(undefined),predicate("Ab"),predicate(2),opaque(2),opaque("x"),own(2),own("x")]) }
