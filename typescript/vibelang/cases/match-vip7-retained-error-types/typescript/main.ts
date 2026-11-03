import {Effect,Cause,Schema} from "effect"
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
export function label(e:unknown){if(Cause.isTimeoutError(e)){const t=e;const typed:Cause.TimeoutError=t;const tag:"TimeoutError"=t._tag;return tag}if(Schema.isSchemaError(e))return "invalid";return "other"}
function retry(t:Cause.TimeoutError):"retry"{return "retry"}
function badInput():"invalid"{return "invalid"}
function rethrow(e:unknown):never{throw e}
export function handle(e:unknown):"retry"|"invalid"{if(Cause.isTimeoutError(e))return retry(e);if(Schema.isSchemaError(e))return badInput();return rethrow(e)}
export function main():Effect.Effect<readonly unknown[]>{const exact:Equal<ReturnType<typeof label>,"TimeoutError"|"invalid"|"other">=true;const timeout={_tag:"TimeoutError","~effect/Cause/TimeoutError":"~effect/Cause/TimeoutError"};const schema={_tag:"SchemaError","~effect/Schema/SchemaError":"~effect/Schema/SchemaError"};return Effect.sync(()=>[exact,label(timeout),label(schema),label({_tag:"TimeoutError"}),handle(timeout),handle(schema),Effect.runSyncExit(Effect.sync(()=>handle({_tag:"unhandled"})))])}
