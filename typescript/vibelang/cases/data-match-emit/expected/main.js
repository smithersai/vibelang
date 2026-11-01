import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime";
const Delivery = Data.taggedEnum();
function describe(delivery) {
    {
        const $match2 = delivery;
        {
            if (Delivery.$is("Waiting")($match2)) {
                return "waiting";
            }
        }
        {
            {
                runtime.$assertMatch(Delivery.$is("Sent")($match2), $match2);
                let tracking = $match2.tracking;
                return tracking;
            }
        }
    }
}
function isSent(value) {
    return (Delivery.$is("Sent")(value));
}
export function main() {
    return Effect.sync({ main: () => [describe(Delivery.Waiting()), describe(Delivery.Sent({ tracking: "parcel-8" })), isSent(Delivery.Sent({ tracking: "x" })), isSent({ tracking: "x" })] }.main);
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
