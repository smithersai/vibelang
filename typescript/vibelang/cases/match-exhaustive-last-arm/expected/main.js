import * as Option from "effect/Option";
import { $noMatch } from "vibelang-runtime";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
// expect-result: {"phases":["Draft","Review","Published"],"widths":[5,6,9],"logged":["draft","review","published"],"failures":["no user 7","retry","denied Ada"],"greetings":["Hello","Hello, Ada"],"announced":"published","text":"text: hi"}
// A match without default that D209 proves exhaustive tests its last arm
// with a check that adds no branch (D405): no final if and no $noMatch,
// after return, inside an
// expression, as a statement, and in an Effect function, and the last arm
// still binds its names (arms.vibe, expected/arms.js). Over a type
// that is not a finite union, a match without default keeps its tests and
// $noMatch, which throws the proposal's TypeError (D209), as text does here.
import { announce, Denied, describe, greeting, NotFound, phaseLabel, record, Timeout, width } from "./arms.js";
import { record$direct, describe$direct, greeting$direct } from "./arms.js";
function text$direct(value) {
    {
        const $match2 = value;
        {
            if (typeof $match2 === "string") {
                let s = $match2;
                return `text: ${s}`;
            }
        }
        return $noMatch($match2);
    }
}
function text(...args) { return runtime.$plainSync(text$direct, this, args); }
text[runtime.$direct] = text$direct;
export function main() {
    return Effect.fnUntraced(runtime.$joinedFrame(function* main() {
        const phases = ["draft", "review", "published"];
        const logged = [];
        {
            let pending_1 = runtime.$normal;
            try {
                for (const phase of phases) {
                    try {
                        record$direct(phase, logged);
                    }
                    catch (thrown_1) {
                        pending_1 = thrown_1;
                        break;
                    }
                }
            }
            catch (thrown_2) {
                throw runtime.$finallyFailure(pending_1, thrown_2);
            }
            if (pending_1 !== runtime.$normal)
                throw pending_1;
        }
        return {
            phases: phases.map(phaseLabel),
            widths: phases.map(width),
            logged,
            failures: [describe$direct(new NotFound({ id: "7" })), describe$direct(new Timeout()), describe$direct(new Denied({ user: "Ada" }))],
            greetings: [greeting$direct(Option.none()), greeting$direct(Option.some("Ada"))],
            announced: yield* announce("published"),
            text: text$direct("hi")
        };
    })).apply(this, arguments);
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
