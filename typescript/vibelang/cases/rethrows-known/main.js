import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime";
import { invoke, tag, risky, safe, fx, overloaded } from "./helpers.js";
import * as Effect from "effect/Effect";
export function accepted() {
    invoke(safe);
    invoke(fx);
    invoke(overloaded);
    return tag `x${safe}`;
}
export function main() {
    let caught = "";
    try {
        invoke(risky);
    }
    catch (error) {
        caught = error.message;
    }
    const bridged = Effect.runSync(Effect.try(() => invoke(safe)));
    return { caught, safe: invoke(safe), bridged };
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(Effect_1.sync(main)));
