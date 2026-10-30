import * as Context from "effect/Context"

export const Flag = Context.Reference<boolean>("t3/Flag", { defaultValue: () => false })

type Other_shape = { id: string }

const Other_base: Context.ServiceClass<Other, "t3/Other", Other_shape> = Context.Service<Other, Other_shape>()("t3/Other")
export class Other extends Other_base {}
export declare namespace Other { type Shape = Other_shape }
