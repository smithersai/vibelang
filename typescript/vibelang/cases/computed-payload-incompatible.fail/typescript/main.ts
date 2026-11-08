const slot = "x" as const
type Repeated = { readonly [slot]: number; readonly ["x"]: string }
export {}
