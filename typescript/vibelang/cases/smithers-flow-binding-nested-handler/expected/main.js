import { $catchExpression, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
// expect-result: [2,0,"open:act:15d","15e",2]
// Minimized from a smithers flow binding: a `sync` callback filters and maps
// flows to bindings whose handler is an `effect` arrow. Each handler is its
// own cold Effect (Chapter 1), so its `try` results are values that feed the
// next call, and nothing in it runs until the handler's Effect runs.
class IssueFailure extends TaggedError("IssueFailure") {
    static {
        $schemaErrorMatcher(this, "IssueFailure", true);
    }
}
const make = (binding) => binding;
const source = (id, bindings) => ({ id, bindings });
let digests = 0;
function digestHex(bytes) {
    return Effect_1.gen(function* digestHex() {
        digests++;
        return bytes.reduce((sum, byte) => sum + byte, 0).toString(16);
    });
}
export function bindings(flows) {
    return Effect_1.gen(function* bindings() {
        return yield* Effect_1.sync(() => source("issues", flows.filter((flow) => flow.startsWith("issues/")).map((flow) => make({
            name: flow,
            handler: (request, call) => {
                return Effect_1.gen(function* handler() {
                    const bytes = yield* Effect_1.sync(() => new TextEncoder().encode(JSON.stringify(call.identity)));
                    const key = yield* digestHex(bytes);
                    if (request.op === "fail")
                        return yield* Effect_1.fail(new IssueFailure({ reason: key }));
                    return `${flow.slice("issues/".length)}:${request.op}:${key}`;
                });
            },
        }))));
    });
}
export function main() {
    return Effect_1.gen(function* main() {
        const built = yield* bindings(["issues/open", "other/x", "issues/close"]);
        const program = built.bindings[0].handler({ op: "act" }, { identity: ["a"] });
        const before = digests;
        const first = yield* program;
        const failed = yield* runtime.$catch(yield* (() => { return Effect_1.sync(() => { return built.bindings[1].handler({ op: "fail" }, { identity: ["b"] }); }); })(), (e) => Effect_1.sync(() => { return e.reason; }));
        return [built.bindings.length, before, first, failed, digests];
    });
}
