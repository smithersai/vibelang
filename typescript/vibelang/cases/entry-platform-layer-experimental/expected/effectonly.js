import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { FileSystem } from "effect/FileSystem";
export function main() {
    return Effect.gen(function* main() {
        yield* Console.log(yield* (yield* FileSystem).readFileString("effect.txt"));
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer)));
