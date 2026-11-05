import {Effect,Data,Schema} from "effect"
function witness(){
const symbol:unique symbol=((Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")) as any
class Root extends Data.TaggedError("Root")<{readonly n:number}>{static [symbol](subject:any,_hint?:{matchType:"boolean"|"extractor"}){return subject?._tag==="Root"?[subject]:false}}
class Empty extends Data.TaggedError("Empty"){static [symbol](subject:any,_hint?:{matchType:"boolean"|"extractor"}){return subject?._tag==="Empty"?[subject]:false}}
class Methods extends Data.TaggedError("Methods")<{readonly n:number}>{static [symbol](subject:any,_hint?:{matchType:"boolean"|"extractor"}){return subject?._tag==="Methods"?[subject]:false}text(){return String(this.n)}}
class SchemaError extends Schema.TaggedError<SchemaError>()("SchemaError",{n:Schema.Number}){static [symbol](subject:any,_hint?:{matchType:"boolean"|"extractor"}){return subject?._tag==="SchemaError"?[subject]:false}}
class NativeChild extends Root {}
const profiles=[
{type:Root,tag:"Root",instance:new Root({n:1}),choose:(s:unknown)=>(()=>{const m=Object.hasOwn(Root,symbol)?Reflect.get(Root,symbol):undefined;return typeof m==="function"?Boolean(m.call(Root,s,{matchType:"boolean"})):s instanceof Root})()},
{type:Empty,tag:"Empty",instance:new Empty(),choose:(s:unknown)=>(()=>{const m=Object.hasOwn(Empty,symbol)?Reflect.get(Empty,symbol):undefined;return typeof m==="function"?Boolean(m.call(Empty,s,{matchType:"boolean"})):s instanceof Empty})()},
{type:Methods,tag:"Methods",instance:new Methods({n:2}),choose:(s:unknown)=>(()=>{const m=Object.hasOwn(Methods,symbol)?Reflect.get(Methods,symbol):undefined;return typeof m==="function"?Boolean(m.call(Methods,s,{matchType:"boolean"})):s instanceof Methods})()},
{type:SchemaError,tag:"SchemaError",instance:new SchemaError({n:3}),choose:(s:unknown)=>(()=>{const m=Object.hasOwn(SchemaError,symbol)?Reflect.get(SchemaError,symbol):undefined;return typeof m==="function"?Boolean(m.call(SchemaError,s,{matchType:"boolean"})):s instanceof SchemaError})()}
]
const rows:boolean[][]=[]
for(const p of profiles){
 const copy:unknown={_tag:p.tag}
 const own=Reflect.get(p.type,symbol)
 const row=[Object.hasOwn(p.type,symbol),p.choose(copy),p.choose(p.instance),Reflect.deleteProperty(p.type,symbol),Object.hasOwn(p.type,symbol),p.choose(copy),p.choose(p.instance)]
 Reflect.defineProperty(p.type,symbol,{value:own,configurable:true,writable:true})
 const descriptor=Object.getOwnPropertyDescriptor(p.type,symbol)!
 row.push(p.choose(copy),p.choose(p.instance),!descriptor.enumerable,!!descriptor.writable,!!descriptor.configurable)
 rows.push(row)
}
function childMatch(s:unknown){return s instanceof NativeChild}
return [rows,Object.hasOwn(NativeChild,symbol),childMatch({_tag:"Root",n:1}),childMatch(new NativeChild({n:1}))]
}
export function main(){return Effect.succeed(witness())}
