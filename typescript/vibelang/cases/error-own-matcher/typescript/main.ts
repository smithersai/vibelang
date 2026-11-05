import { Effect, Data } from "effect"
function witness():unknown[] { try {
const symbol:unique symbol=((Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")) as any
class First extends Data.TaggedError("First")<{readonly n:number}> {
 static [symbol](subject: any, _hint?: { matchType: "boolean" | "extractor" }) { return subject?._tag === "First" ? [subject] : false }
}
class Empty extends Data.TaggedError("Empty") {
 static [symbol](subject: any, _hint?: { matchType: "boolean" | "extractor" }) { return subject?._tag === "Empty" ? [subject] : false }
}
class Last extends Data.TaggedError("Last")<{readonly reason:string}> {
 static [symbol](subject: any, _hint?: { matchType: "boolean" | "extractor" }) { return subject?._tag === "Last" ? [subject] : false }
 messageText() { return this.reason }
}
class Child extends First {}
const Alias = First
const rows: boolean[][] = []
for (const entry of [{type:First,tag:"First"},{type:Empty,tag:"Empty"},{type:Last,tag:"Last"},{type:Alias,tag:"First"}]) {
 const matcher = Reflect.get(entry.type, symbol)
 if(typeof matcher!=="function")return ["missing"]
 const subject={_tag:entry.tag}
 const booleans: boolean[]=[Object.hasOwn(entry.type,symbol)]
 for(const matchType of ["boolean","extractor"] as const) {
  const result=matcher(subject,{matchType})
  booleans.push(Array.isArray(result)&&result.length===1&&result[0]===subject)
  const bound=matcher.call(Child,subject,{matchType})
  booleans.push(Array.isArray(bound)&&bound.length===1&&bound[0]===subject)
  booleans.push(matcher({_tag:"Other"},{matchType})===false)
  booleans.push(matcher(null,{matchType})===false)
 }
 rows.push(booleans)
}
const tagOnly:unknown={_tag:"First",n:1}
const own=new Child({n:1})
function childMatches(value:unknown){return value instanceof Child}
return [rows,Object.hasOwn(Child,symbol),childMatches(tagOnly),childMatches(own)]
} catch(e) { return ["threw",(e as Error).name] } }

export function main(): Effect.Effect<unknown[]> { return Effect.succeed(witness()) }
