import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
export function main() {
    return Effect.gen(function* main() {
        yield* Console.log("needs no service");
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => NodeRuntime.runMain(main()));
