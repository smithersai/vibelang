import * as Console from "effect/Console";
import * as Redacted from "effect/Redacted";
import { Experimental } from "vibelang-runtime";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime";
import { ExperimentalBrowserServices as ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser";
export function main() {
    return Effect.gen(function* main() {
        const mac = yield* (yield* Experimental.Crypto.Crypto).hmac("SHA-256", Redacted.make(new Uint8Array([1])), new Uint8Array([2]));
        yield* Console.log(mac.length);
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => BrowserRuntime.runMain(Effect.provide(main(), ExperimentalBrowserServices.layer)));
