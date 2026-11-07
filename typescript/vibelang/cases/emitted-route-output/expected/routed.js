// A native module that setup routed to counter.vibe. Its JavaScript and
// declarations name ./counter.js, the module's own output, so no route
// reaches published code (expected/).
export * from "./counter.js";
import { bump } from "./counter.js";
/** @throws {never} */
export const bumpTwice = () => {
    bump();
    return bump();
};
export const load = () => import("./counter.js");
