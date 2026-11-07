// The route's default target: a second copy of counter.vibe's JavaScript.
// Compiled output that kept the route would load this copy, whose state is
// not counter.js's.
export const state = { count: 0 }

export function bump() {
  state.count += 1
  return state.count
}
