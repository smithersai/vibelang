import type * as Effect from "effect/Effect"
export interface Like<W> { readonly witness: W }
export interface Plat<W> { (id: string): any; readonly platform: W }
export type Resource<W> = ((id: string) => Effect.Effect<W>) & Like<W>
export declare const OnlyData: Resource<number>
export declare const Incompatible: Resource<number> & { readonly platform: true }
export declare const Compatible: Resource<number> & { readonly platform: number }
export declare function take<W>(value: Like<W> | Plat<W>): W
export declare function array<W>(value: (Like<W> | Plat<W>)[]): W
export declare function constrained<T extends Like<any> | Plat<any>>(value: T[]): number
export declare function late<W>(value: Like<NoInfer<W>> | Plat<NoInfer<W>>, output: () => W): W
export declare function boxed<W>(value: { readonly item: Like<W> | Plat<W> }): W
