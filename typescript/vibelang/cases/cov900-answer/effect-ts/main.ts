// Chapter 900: cov900-answer — independent Effect reference.
import {Effect} from "effect"
export const answer=42
export function main(){return Effect.gen(function*(){return [answer]})}
