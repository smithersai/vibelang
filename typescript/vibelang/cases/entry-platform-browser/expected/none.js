import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime";
export function main() {
    return Effect.gen(function* main() {
        yield* Console.log("browser main ran");
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => BrowserRuntime.runMain(main()));
