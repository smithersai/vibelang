export type MessageUnion<A> = { readonly _tag: "Message"; readonly value: A }
export const defineMessageUnion = <A>(value: A): MessageUnion<A> => ({ _tag: "Message", value })
