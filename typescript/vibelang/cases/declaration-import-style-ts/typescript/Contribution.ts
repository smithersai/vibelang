export type Refusal = { readonly reason: string }

export const refuse: {
    /** @throws {never} */
    (reason: string): Refusal;
} = (reason: string): Refusal => ({ reason })
