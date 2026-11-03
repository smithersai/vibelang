import { Effect, Option, Exit, Cause } from "effect"
import * as HttpClientError from "effect/http/HttpClientError"
import { rethrow } from "./rethrow.js"
// Fixed patterns apply these exact module guards to the subject. Effect's
// declarations restrict their parameter to an already-known Option/Exit;
// widening that parameter here changes no call or runtime check.
const isSome = Option.isSome as (u:unknown)=>u is Option.Some<unknown>
const isFailure = Exit.isFailure as (u:unknown)=>u is Exit.Failure<never,unknown>
export function mixed(x:unknown):unknown{if(isSome(x))return x.value;if(isFailure(x))return Cause.pretty(x.cause);if(Cause.isTimeoutError(x))return "timeout";return "other"}
function retry(h:HttpClientError.HttpClientError):string{return h._tag}
export function errors(e:unknown):string{if(HttpClientError.isHttpClientError(e))return retry(e);if(Cause.isTimeoutError(e))return "timeout";return rethrow(e)}
export function main():Effect.Effect<readonly unknown[]>{const timeout={_tag:"TimeoutError","~effect/Cause/TimeoutError":"~effect/Cause/TimeoutError"};const http={_tag:"HttpClientError","~effect/http/HttpClientError":"~effect/http/HttpClientError"};return Effect.sync(()=>[mixed(Option.some(7)),mixed(Exit.fail("bad")),mixed(timeout),mixed({}),errors(http),errors(timeout),Effect.runSyncExit(Effect.sync(()=>errors({_tag:"unhandled"})))])}
