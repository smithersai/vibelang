import * as Effect from "effect/Effect"
import * as M from "./out/main.js"
function inspect(effect) {
 const result = Effect.runSyncExit(effect)
 if (result._tag === "Success") return ["Success", result.value]
 if (result.cause.reasons.length !== 1) throw new Error("unexpected reasons")
 const reason = result.cause.reasons[0]
 if (reason._tag !== "Die" || !(reason.defect instanceof TypeError) || reason.defect.message !== "") throw new Error("no-match did not die with an empty TypeError")
 return ["Die", "TypeError", ""]
}
console.log(JSON.stringify([
 M.numberCase(1), M.numberCase(2), M.tagCase({_tag:"A"}), M.tagCase({_tag:"B"}),
 M.voidCase(undefined), M.genericCase(null), M.genericCase(5),
 M.callableCase({_tag:"A"}), M.callableCase(()=>{})
].map(inspect)))
