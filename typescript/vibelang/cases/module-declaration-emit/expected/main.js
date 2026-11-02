import * as Console from "effect/Console";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime";
// Each module declaration the file imports compiles to a JavaScript module of
// its own (D403), main.vibe.<name>.js beside main.js, which main.js imports
// where the source wrote the module's name. A module the file imports only
// types from, and one it never imports, emit no JavaScript; each module's
// declarations are a declaration file of their own, main.vibe.<name>.d.ts.
import Counter, { clean, Mode } from "./main.vibe.text.js";
import * as tools from "./main.vibe.text.js";
import { level } from "./main.vibe.config.js";
import "./main.vibe.setup.js";
export { clean as tidy } from "./main.vibe.text.js";
export * from "./main.vibe.extras.js";
export function describe$direct(shape) {
    return `${shape.width}x${shape.height}`;
}
export function describe(...args) { return runtime.$plainSync(describe$direct, this, args); }
describe[runtime.$direct] = describe$direct;
export function main() {
    return Effect_1.fnUntraced(function* main() {
        const counter = yield* Effect_1.sync(() => new Counter());
        const counted = yield* Effect_1.sync(((counter) => counter.increment()).bind(undefined, counter));
        yield* Console.log(JSON.stringify({
            cleaned: yield* Effect_1.sync(() => clean(" ab ")),
            upper: yield* Effect_1.sync(() => clean(" ab ", Mode.Upper)),
            doubled: yield* Effect_1.sync(() => tools.double("x")),
            prefix: tools.prefix,
            more: tools.moreModule.more,
            area: yield* Effect_1.sync(() => tools.area({ width: 2, height: 3 })),
            level,
            counted,
            described: describe$direct({ width: 1, height: 2 }),
        }));
    }).apply(this, arguments);
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
