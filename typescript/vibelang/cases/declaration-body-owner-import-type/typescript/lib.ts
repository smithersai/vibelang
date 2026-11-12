export interface Provider<A> {
  readonly value: A
}

export const make = <A>(value: A): Provider<A> => ({ value })
