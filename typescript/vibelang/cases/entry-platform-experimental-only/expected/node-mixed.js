import * as Console from "effect/Console";
import * as FileSystem from "effect/FileSystem";
import { Experimental } from "vibelang-runtime";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { ExperimentalNodeServices as ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node";
export function main() {
    return Effect.gen(function* main() {
        const pid = yield* (yield* Experimental.Process.Process).pid;
        yield* Console.log(`node mixed ${yield* (yield* FileSystem.FileSystem).exists("package.json")} ${pid > 0}`);
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => NodeRuntime.runMain(Effect.provide(main(), ExperimentalNodeServices.layer)));
