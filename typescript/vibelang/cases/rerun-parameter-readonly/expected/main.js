import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime";
// Read-only parameters keep the direct optimization. Shadowed writes and
// mutations of caller-owned objects do not write the parameter binding.
export const compact = (n) => Effect_1.sync({ compact: () => { return n + 1; } }.compact);
export function declared$direct(n) { return n + 1; }
export function declared(...args) { return runtime.$plainSync(declared$direct, this, args); }
declared[runtime.$direct] = declared$direct;
export class Counter {
    read(n) {
        return Effect_1.sync({ read: () => n + 1 }.read);
    }
}
export const shadowed = (n) => Effect_1.sync({ shadowed: () => { return [n].map((n) => ++n)[0]; } }.shadowed);
export const property = (value) => Effect_1.sync({ property: () => { return ++value.n; } }.property);
export function plain$direct(n) { return ++n; }
// Plain exports bind parameters inside their delayed $direct call.
export function plain(...args) { return runtime.$plainSync(plain$direct, this, args); }
plain[runtime.$direct] = plain$direct;
export function plainRest$direct(...values) { return values.pop(); }
export function plainRest(...args) { return runtime.$plainSync(plainRest$direct, this, args); }
plainRest[runtime.$direct] = plainRest$direct;
export const hatch = (n) => Effect_1.suspend({ hatch: () => { return Effect_1.sync(((n) => ++n).bind(undefined, n)); } }.hatch);
export const shorthand = (n) => Effect_1.sync({ shorthand: () => { return ({ n }); } }.shorthand);
// Explicit program factories intentionally keep their eager outer state.
export function factory(n) { return Effect_1.sync(() => ++n); }
//# sourceMappingURL=main.js.map