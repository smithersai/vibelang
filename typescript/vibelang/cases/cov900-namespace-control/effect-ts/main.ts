// Chapter 900: cov900-namespace-control — independent Effect reference.
import {Effect} from "effect"
namespace Good {export async function run(){return await Promise.resolve(42)}}
const value=await Good.run()
export function main(){return Effect.gen(function*(){return [value]})}
