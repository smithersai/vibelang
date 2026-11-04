export type Refusal = { readonly reason: string }

export const refuse = (reason: string): Refusal => ({ reason })
