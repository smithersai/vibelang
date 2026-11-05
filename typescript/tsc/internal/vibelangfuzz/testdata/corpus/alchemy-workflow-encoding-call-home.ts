import * as Effect from "effect/Effect";
export const decode=(text:string)=>Effect.succeed(JSON.parse(text));
export const keep=()=>1;
