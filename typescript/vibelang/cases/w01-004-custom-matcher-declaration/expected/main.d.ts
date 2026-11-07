import { customMatcher } from "vibelang-runtime";
import { Effect } from "effect";
export declare class One {
    /** @throws {never} */
    static [customMatcher](s: unknown, _options: {
        matchType: "extractor";
    }): false | [number];
}
export declare function main(): Effect.Effect<unknown>;
