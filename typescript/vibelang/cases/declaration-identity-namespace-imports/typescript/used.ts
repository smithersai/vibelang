import * as Context from "effect/Context"

export const Flag = Context.Reference<boolean>("t3/Flag", { defaultValue: () => false })

export class Other extends Context.Service<Other, { readonly id: string }>()("t3/Other") {}
