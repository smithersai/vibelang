export type State = { readonly _tag: "Idle" } | { readonly _tag: "Ready"; readonly value: number }

/** @throws {never} */
export function identity(state: State): State {
  switch (state._tag) {
    case "Idle": return state;
    case "Ready": return state;
  }
}
/** @throws {never} */
export function left(state: State): State { return identity(state); }
/** @throws {never} */
export function nested(state: State): State { return identity(state); }
/** @throws {never} */
export function control(state: State): State { return identity(state); }
