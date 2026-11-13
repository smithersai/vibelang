import {Context,Effect,Layer} from "effect"
type NumberShape={/** @throws {never} */ constructor():number}
export class NumberMethod extends Context.Service<NumberMethod,NumberShape>()("constructor-methods/NumberMethod"){}
export declare namespace NumberMethod {type Shape=NumberShape}
type IdentityShape={/** @throws {never} */ constructor<T>(value:T):T}
export class IdentityMethod extends Context.Service<IdentityMethod,IdentityShape>()("constructor-methods/IdentityMethod"){}
export declare namespace IdentityMethod {type Shape=IdentityShape}
const numberMethod:NumberShape={constructor:()=>7}
const identityMethod:IdentityShape={constructor:<T>(value:T):T=>value}
export function main(){
 return Effect.gen(function*(){
  return yield* Effect.provide(Effect.gen(function*(){
   return [(yield* NumberMethod).constructor(),(yield* IdentityMethod).constructor("ok")]
  }),[Layer.succeed(NumberMethod,numberMethod),Layer.succeed(IdentityMethod,identityMethod)])
 })
}
