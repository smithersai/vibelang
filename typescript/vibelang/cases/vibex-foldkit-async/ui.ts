import type { Effect } from "effect"
export type Todo = { id: number; text: string; done: boolean }
export type User = { name: string }
export interface Atom<A> { readonly value: A }
export interface Result<A> { readonly value: A }
declare global { namespace JSX {
  interface Element { readonly kind: "element" }
  interface IntrinsicElements { [tag: string]: any }
} }
/** @throws {never} */
export declare function memo<A>(f: A): A
/** @throws {never} */
export declare function useCallback<A>(f: A, deps: readonly unknown[]): A
/** @throws {never} */
export declare function useAtomSet<A>(atom: Atom<A>): (update: (value: A) => A) => void
/** @throws {never} */
export declare function useAtomValue<A>(atom: Atom<A>): A
/** @throws {never} */
export declare function emptyTodo(): Todo
export declare const todosAtom: Atom<readonly Todo[]>
export declare const Atom: {
  /** @throws {never} */
  make<A>(a: A): Atom<A>
}
export declare const runtime: {
  /** @throws {never} */
  atom<A, E, R>(effect: Effect.Effect<A, E, R>): Atom<Result<A>>
}
export declare const Api: Effect.Effect<{ /** @throws {never} */ getUser(): Effect.Effect<User> }>
export declare const AsyncResult: {
  /** @throws {never} */
  builder<A>(value: Result<A>): {
    /** @throws {never} */
    onInitial(f: () => JSX.Element): {
      /** @throws {never} */
      onFailure(f: (cause: string) => JSX.Element): {
        /** @throws {never} */
        onSuccess(f: (user: A) => JSX.Element): {
          /** @throws {never} */
          render(): JSX.Element
        }
      }
    }
  }
}
/** @throws {never} */
export declare function Spinner(): JSX.Element
/** @throws {never} */
export declare function ErrorBanner(props: { message: string }): JSX.Element
/** @throws {never} */
export declare function Profile(props: { user: User }): JSX.Element
