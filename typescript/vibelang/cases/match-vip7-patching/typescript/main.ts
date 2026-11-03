import * as Predicate from "effect/Predicate"
import * as HttpClient from "effect/http/HttpClient"
import { Effect, Data, Schema, Cause, Config, PlatformError, Option, Exit, Result } from "effect"
import * as AiError from "effect/ai/AiError"
import * as SqlError from "effect/sql/SqlError"
import * as CliError from "effect/cli/CliError"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
export function patching():readonly boolean[] {
 const roots:object[]=[Function.prototype,Array,Date,Map,Set,Error,RegExp,WeakMap,WeakSet,Promise,Uint8Array,ArrayBuffer,AggregateError,Cause.TimeoutError]
 return [...roots.map(x=>Object.hasOwn(x,customMatcher)),Object.hasOwn(Option,"Some"),Object.hasOwn(Option,"None"),Object.hasOwn(Exit,"Success"),Object.hasOwn(Exit,"Failure"),Object.hasOwn(Result,"Success"),Object.hasOwn(Result,"Failure")]
}
class Plain {}
function constructed():readonly boolean[]{return [Object.create(Plain.prototype),new Plain(),{}].map(s=>s instanceof Plain)}
function predicates(s:unknown):readonly boolean[]{return [Predicate.isError(s),CliError.isCliError(s),HttpClient.isTransientError(s)]}
export function localOption(s:unknown):number {const Option={Some:(x:unknown):x is number=>typeof x==="number"};return Option.Some(s)?1:0}
export function ordinary(s:unknown):readonly boolean[] {return [s instanceof Config.ConfigError,s instanceof PlatformError.BadArgument,s instanceof PlatformError.SystemError,s instanceof AiError.RateLimitError,s instanceof SqlError.ConnectionError,s instanceof CliError.UnrecognizedOption,s instanceof CliError.DuplicateOption,s instanceof CliError.MissingOption,s instanceof CliError.MissingArgument,s instanceof CliError.UnexpectedArgument,s instanceof CliError.InvalidValue,s instanceof CliError.UnknownSubcommand,s instanceof CliError.ValidationError,s instanceof CliError.UserError,s instanceof CliError.ShowHelp]}
export function main():Effect.Effect<readonly unknown[]> {return Effect.sync(()=>[patching(),constructed(),[new Error("x"),null,{}, {_tag:"TimeoutError","~effect/Cause/TimeoutError":"~effect/Cause/TimeoutError"}].map(predicates),localOption(2),localOption("x"),[Config.ConfigError,PlatformError.BadArgument,PlatformError.SystemError,AiError.RateLimitError,SqlError.ConnectionError,CliError.UnrecognizedOption,CliError.DuplicateOption,CliError.MissingOption,CliError.MissingArgument,CliError.UnexpectedArgument,CliError.InvalidValue,CliError.UnknownSubcommand,CliError.ValidationError,CliError.UserError,CliError.ShowHelp].flatMap(C=>[Object.create(C.prototype),{_tag:C.name},null]).map(ordinary)])}
