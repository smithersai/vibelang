export const state = { initializations: 0 }
/** @throws {never} */
export function initialize() {
  state.initializations++
  return { enabled: true }
}
