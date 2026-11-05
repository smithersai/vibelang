import * as Effect from "effect/Effect";
export const make=()=>({run:Effect.fnUntraced(function*(){return 1;})});
