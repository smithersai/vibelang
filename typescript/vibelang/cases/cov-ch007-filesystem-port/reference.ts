import {Effect,FileSystem} from "effect"
type OriginalService=import("effect/FileSystem").FileSystem
type PortedService=FileSystem.FileSystem
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Expect<T extends true>=T
type ServiceProof=Expect<Equal<OriginalService,PortedService>>
export function probe(){return Effect.gen(function*(){return typeof FileSystem.FileSystem==='function'})}
const success:Equal<Effect.Success<ReturnType<typeof probe>>,boolean>=true
const failure:Equal<Effect.Error<ReturnType<typeof probe>>,never>=true
const requirements:Equal<Effect.Services<ReturnType<typeof probe>>,never>=true
export const typeEvidence=[success,failure,requirements]
