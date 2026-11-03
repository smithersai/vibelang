import { Effect, Option, Data } from "effect"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
export function ordinary(s:Date|{kind:string}) {if(!(s instanceof Date))return s.kind;return s.getUTCFullYear()}
export function literal(s:"a"|"b"|null|undefined):"b"|"other" {if(!(s==="a"||s===null||s===undefined))return s;return "other"}
export function predicate(s:string|number) {const p=(x:string|number):x is string=>typeof x==="string";if(!p(s))return s.toFixed(1);return s.toUpperCase()}
export function opaque(s:string|number):string|number {const p=(x:unknown):boolean=>typeof x==="string";if(!p(s)){const a:typeof s=1;const b:typeof s="x";return s}const a:typeof s=1;const b:typeof s="x";return s}
export function own(s:string|number):string|number {class C{static [customMatcher](x:unknown):boolean{return typeof x==="string"}};if(!C[customMatcher](s)){const a:typeof s=1;const b:typeof s="x";return s}const a:typeof s=1;const b:typeof s="x";return s}
class Plain {n=1}
function ordinaryClass(s:Plain|{kind:string}) {if(!(s instanceof Plain))return s.kind;return s.n}
function primitive(s:string|number){if(typeof s!=="string")return s.toFixed(0);return s.toUpperCase()}
function fixed(s:Option.Option<number>){if(!Option.isSome(s)){const tag:"None"=s._tag;return tag}return s.value}
class E extends Data.TaggedError("E")<{readonly id:string}>{}
function tagged(s:E|{_tag:"Other";n:number}){if(s._tag!=="E")return s.n;return s.id}
export function main():Effect.Effect<readonly unknown[]> { return Effect.sync(()=>[ordinary(new Date(0)),ordinary({kind:"k"}),literal("a"),literal("b"),literal(null),literal(undefined),predicate("Ab"),predicate(2),opaque(2),opaque("x"),own(2),own("x"),ordinaryClass(new Plain()),ordinaryClass({kind:"k"}),primitive(2),primitive("x"),fixed(Option.none()),fixed(Option.some(3)),tagged(new E({id:"e"})),tagged({_tag:"Other",n:7})]) }
