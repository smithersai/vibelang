import { Effect, Option, Exit, Result } from "effect"
export function union(s:boolean) { if(s===true)return 1 as const; return "no" as const }
export function narrow(s:{_tag:"A";id:string|number}|{_tag:"B";value:number}) { if(s._tag==="A"&&typeof s.id==="string")return s.id.toUpperCase();return s._tag }
export function boolean(s:string|number) { const yes:boolean=typeof s==="string";if(typeof s==="string")return s.length;return yes?0:s*2 }
export function both(s:{a:number;b:number}|null) { if(s!==null&&"a" in s&&"b" in s){const a=s.a,b=s.b;return a+b}return 0 }
export function option(s:Option.Option<number>) { if(Option.isSome(s))return s.value;if(Option.isNone(s))return 0;const left:never=s;throw new TypeError() }
export function result(s:Result.Result<number,string>) { if(Result.isSuccess(s))return s.success;if(Result.isFailure(s))return s.failure.length;const left:never=s;throw new TypeError() }
export function exit(s:Exit.Exit<number,string>) { if(Exit.isSuccess(s))return s.value;if(Exit.isFailure(s))return s.cause.reasons.length;const left:never=s;throw new TypeError() }
export function main():Effect.Effect<readonly unknown[]> { return Effect.sync(()=>[union(true),union(false),narrow({_tag:"A",id:"ab"}),narrow({_tag:"A",id:1}),narrow({_tag:"B",value:2}),boolean("abc"),boolean(2),both({a:1,b:2}),both(null),option(Option.some(2)),option(Option.none()),result(Result.succeed(3)),result(Result.fail("err")),exit(Exit.succeed(4)),exit(Exit.fail("err"))]) }
