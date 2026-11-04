import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
const Delivery = Data.taggedEnum();
function describe(delivery) {
    {
        const $match2 = delivery;
        {
            if ((typeof $match2 === "function" || typeof $match2 === "object") && $match2
                !== null && "_tag" in
                $match2 && $match2._tag === "Waiting") {
                return "waiting";
            }
        }
        {
            {
                runtime.$assertMatch((typeof $match2 === "function" || typeof $match2 === "object") && $match2
                    !== null && "_tag" in
                    $match2 && $match2._tag === "Sent" && "tracking" in
                    $match2, $match2);
                let tracking = $match2.tracking;
                return tracking;
            }
        }
    }
}
function isSent(value) {
    return ($is3 => (typeof $is3 === "function" || typeof $is3 === "object") && $is3 !== null && "_tag" in $is3 && $is3._tag === "Sent")(value);
}
export function main() {
    return Effect.sync({ main: () => { return [describe(Delivery.Waiting()), describe(Delivery.Sent({ tracking: "parcel-8" })), isSent(Delivery.Sent({ tracking: "x" })), isSent({ tracking: "x" })]; } }.main);
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
