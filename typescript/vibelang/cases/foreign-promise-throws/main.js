import { risky, safe, unannotated } from "./helpers.js";
import * as Effect from "effect/Effect";
export async function asynchronous() { return risky(); }
export async function asyncDefault(value = risky()) { return value; }
export function accepted() { return [safe(), unannotated(), new Promise(resolve => resolve(1))]; }
export function main() {
    let caught = "";
    try {
        risky();
    }
    catch (error) {
        caught = error.message;
    }
    const exit = Effect.runSyncExit(Effect.try(() => { risky(); return 1; }));
    return { caught, bridged: exit._tag };
}
