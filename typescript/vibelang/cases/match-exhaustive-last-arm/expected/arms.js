import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { $extract, $is, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import * as Option_1 from "effect/Option";
export class NotFound extends TaggedError("NotFound") {
    static {
        $schemaErrorMatcher(this, "NotFound", true);
    }
}
export class Timeout extends TaggedError("Timeout") {
    static {
        $schemaErrorMatcher(this, "Timeout", true);
    }
}
export class Denied extends TaggedError("Denied") {
    static {
        $schemaErrorMatcher(this, "Denied", true);
    }
}
// After return.
export function phaseLabel(phase) {
    {
        const $match2 = phase;
        {
            if ($match2
                === "draft") {
                return "Draft";
            }
        }
        {
            if ($match2
                === "review") {
                return "Review";
            }
        }
        {
            {
                runtime.$assertMatch($match2
                    === "published", $match2);
                return "Published";
            }
        }
    }
}
// Inside an expression, where the match runs in its own function.
export function width(phase) {
    const label = (() => {
        const $match3 = phase;
        {
            if ($match3
                === "draft") {
                return 5;
            }
        }
        {
            if ($match3
                === "review") {
                return 6;
            }
        }
        {
            {
                runtime.$assertMatch($match3
                    === "published", $match3);
                return 9;
            }
        }
    })();
    return label;
}
// As a statement.
export function record(phase, log) {
    $match5: {
        const $match6 = phase;
        {
            if ($match6
                === "draft") {
                log.push("draft");
                break $match5;
            }
        }
        {
            if ($match6
                === "review") {
                log.push("review");
                break $match5;
            }
        }
        {
            {
                runtime.$assertMatch($match6
                    === "published", $match6);
                log.push("published");
                break $match5;
            }
        }
    }
}
// The last arms still bind the whole error and the Option payload.
export function describe(failure) {
    {
        const $match10 = failure;
        {
            const $extracted11 = runtime.$extract(NotFound, $match10, null, true, "construct");
            if ($extracted11 !== false && $extracted11.length === 1) {
                let found = $extracted11[0];
                return `no user ${found.id}`;
            }
        }
        {
            if (runtime.$is(Timeout, $match10, null, true, "construct")) {
                return "retry";
            }
        }
        {
            const $extracted12 = runtime.$extract(Denied, $match10, null, true, "construct");
            {
                runtime.$assertMatch($extracted12 !== false && $extracted12.length === 1, $match10);
                let denied = $extracted12[0];
                return `denied ${denied.user}`;
            }
        }
    }
}
export function greeting(name) {
    {
        const $match15 = name;
        {
            if ((subject_1 => Option_1.isOption(subject_1) && Option_1.isNone(subject_1))($match15)) {
                return "Hello";
            }
        }
        {
            const $extracted16 = (subject_2 => Option_1.isOption(subject_2) && Option_1.isSome(subject_2) && [subject_2.value])($match15);
            {
                runtime.$assertMatch($extracted16 !== false && $extracted16.length === 1, $match15);
                let n = $extracted16[0];
                return `Hello, ${n}`;
            }
        }
    }
}
// In an Effect function, whose arms run Effects.
export function announce(phase) {
    return Effect_1.gen(function* announce() {
        $match18: {
            const $match19 = phase;
            {
                if ($match19
                    === "draft") {
                    yield* Effect.log("draft");
                    break $match18;
                }
            }
            {
                if ($match19
                    === "review") {
                    yield* Effect.log("review");
                    break $match18;
                }
            }
            {
                {
                    runtime.$assertMatch($match19
                        === "published", $match19);
                    yield* Effect.log("published");
                    break $match18;
                }
            }
        }
        return phase;
    });
}
