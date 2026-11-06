import * as Effect from "effect/Effect";
export function make(){return {load:Effect.fn("fixture.load")(function*(){return 1;})};}
