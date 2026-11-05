import * as Chunk from "effect/Chunk";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { flow, identity } from "effect/Function";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
// Every export of effect's root is in scope without an import (D146), after
// the prelude's names. JavaScript's own built-ins keep their meaning, a host
// global does not (the DOM's Option is in this project's lib), and a local
// declaration shadows an export. The emitted JavaScript imports each module
// the file uses as a value, and nothing for a name used only in a type.
const Duration = { label: "local" };
export function firstOf(values) {
    return Chunk.head(values);
}
// expect-result: {"doubled":4,"size":3,"first":1,"id":5,"twice":8,"isArray":true,"text":"7","local":"local"}
export function main() {
    return Effect.gen(function* main() {
        yield* Console.log("effect's root is in scope");
        const doubled = Option.map(Option.some(2), (n) => n * 2);
        const values = Chunk.make(1, 2, 3);
        return {
            doubled: Option.getOrElse(doubled, () => 0),
            size: Chunk.size(values),
            first: Option.getOrElse(firstOf(values), () => 0),
            id: identity(5),
            twice: flow((n) => n + 1, (n) => n * 2)(3),
            isArray: Array.isArray([1]),
            text: String(7),
            local: Duration.label,
        };
    });
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
