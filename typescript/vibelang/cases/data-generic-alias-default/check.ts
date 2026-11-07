import type { Box, BoxOf } from "./main.js"
type Equal<X,Y>=(<T>()=>T extends X?1:2) extends (<T>()=>T extends Y?1:2)?true:false
type Assert<T extends true>=T
// The alias's default instantiates the data type; an explicit argument wins.
type Defaulted=Assert<Equal<BoxOf,Box<string>>>
type Explicit=Assert<Equal<BoxOf<number>,Box<number>>>
