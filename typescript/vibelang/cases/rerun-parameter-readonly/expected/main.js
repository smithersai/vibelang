import * as Effect_1 from "effect/Effect";
// Read-only parameters keep the direct optimization. Shadowed writes and
// mutations of caller-owned objects do not write the parameter binding.
export const compact = (n) => Effect_1.sync({ compact: () => { return n + 1; } }.compact);
export function declared(n) {
    return Effect_1.sync({ declared: () => { return n + 1; } }.declared);
}
export class Counter {
    read(n) {
        return Effect_1.sync({ read: () => { return n + 1; } }.read);
    }
}
export const shadowed = (n) => Effect_1.sync({ shadowed: () => { return [n].map((n) => ++n)[0]; } }.shadowed);
export const property = (value) => Effect_1.sync({ property: () => { return ++value.n; } }.property);
// Plain exports are plain JavaScript functions (VIP-1).
export function plain(n) { return ++n; }
export function plainRest(...values) { return values.pop(); }
export const hatch = (n) => {
    return Effect_1.gen(function* hatch() { return yield* Effect_1.sync(((n) => ++n).bind(undefined, n)); });
};
export const shorthand = (n) => Effect_1.sync({ shorthand: () => { return ({ n }); } }.shorthand);
// Explicit program factories intentionally keep their eager outer state.
export function factory(n) { return Effect_1.sync(() => { return ++n; }); }
//# sourceMappingURL=main.js.map