import type { Data } from "effect"
import type { $One$Definition$3,$Two$Definition$2,$Three$Definition,$Four$Definition$2,One,Two,Three,Four } from "./main.js"
type Equal<X,Y>=(<T>()=>T extends X?1:2) extends (<T>()=>T extends Y?1:2)?true:false
type Assert<T extends true>=T
type OneExact=Assert<Equal<Data.TaggedEnum.Kind<$One$Definition$3,number>,One<number>>>
type TwoExact=Assert<Equal<Data.TaggedEnum.Kind<$Two$Definition$2,number,string>,Two<number,string>>>
type ThreeExact=Assert<Equal<Data.TaggedEnum.Kind<$Three$Definition,number,string,boolean>,Three<number,string,boolean>>>
type FourExact=Assert<Equal<Data.TaggedEnum.Kind<$Four$Definition$2,number,string,boolean,number>,Four<number,string,boolean,number>>>
