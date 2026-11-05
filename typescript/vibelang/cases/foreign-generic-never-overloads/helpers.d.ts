type Evolver<S> = { readonly [K in keyof S]?: (value: S[K]) => unknown }
export declare namespace Struct {
  const evolve: {
    /** @throws {never} */
    <S extends object, E extends Evolver<S>>(e: E): (self: S) => S
    /** @throws {never} */
    <S extends object, E extends Evolver<S>>(self: S, e: E): S
  }
}
