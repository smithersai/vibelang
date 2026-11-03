export type MessageUnion<A> = { readonly _tag: "Message"; readonly value: A }
export const makeMessage: {
    /** @throws {never} */
    <A>(value: A): MessageUnion<A>;
} = <A>(value: A): MessageUnion<A> => ({ _tag: "Message", value })
