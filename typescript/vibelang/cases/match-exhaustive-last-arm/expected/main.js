import * as Option from "effect/Option";
import { $noMatch } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
// expect-result: {"phases":["Draft","Review","Published"],"widths":[5,6,9],"logged":["draft","review","published"],"failures":["no user 7","retry","denied Ada"],"greetings":["Hello","Hello, Ada"],"announced":"published","text":"text: hi"}
// A match without default that D209 proves exhaustive tests its last arm
// with a check that adds no branch (D405): no final if and no $noMatch,
// after return, inside an
// expression, as a statement, and in an Effect function, and the last arm
// still binds its names (arms.vibe, expected/arms.js). Over a type
// that is not a finite union, a match without default keeps its tests and
// $noMatch, which throws the proposal's TypeError (D209), as text does here.
import { announce, Denied, describe, greeting, NotFound, phaseLabel, record, Timeout, width } from "./arms.js";
function text(value) {
    {
        const $match3 = value;
        {
            if (typeof $match3 === "string" || $match3 instanceof String) {
                const $primitive4 = typeof $match3 === "string" ?
                    $match3
                    : $match3.valueOf();
                let s = $primitive4;
                return `text: ${s}`;
            }
        }
        return $noMatch($match3);
    }
}
export function main() {
    return Effect.gen(function* main() {
        const phases = ["draft", "review", "published"];
        const logged = [];
        for (const phase of phases)
            record(phase, logged);
        return {
            phases: phases.map(phaseLabel),
            widths: phases.map(width),
            logged,
            failures: [describe(new NotFound({ id: "7" })), describe(new Timeout()), describe(new Denied({ user: "Ada" }))],
            greetings: [greeting(Option.none()), greeting(Option.some("Ada"))],
            announced: yield* announce("published"),
            text: text("hi")
        };
    });
}
