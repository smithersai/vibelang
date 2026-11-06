import * as Data from "effect/Data";
import { $matchCache } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
const Delivery = Data.taggedEnum();
function describe(delivery) {
    {
        const $matchCache4 = $matchCache();
        try {
            const $match3 = delivery;
            {
                if ((typeof $match3 === "function" || typeof $match3 === "object") && $match3
                    !== null && $matchCache4.propertyHas($match3, "_tag") && $matchCache4.get($match3, "_tag") === "Waiting") {
                    return "waiting";
                }
            }
            {
                {
                    runtime.$assertMatch((typeof $match3 === "function" || typeof $match3 === "object") && $match3
                        !== null && $matchCache4.propertyHas($match3, "_tag") && $matchCache4.get($match3, "_tag") === "Sent" && $matchCache4.propertyHas($match3, "tracking"), $match3);
                    let tracking = $matchCache4.get($match3, "tracking");
                    return tracking;
                }
            }
        }
        catch (matchError_1) {
            $matchCache4.threw(matchError_1);
            throw matchError_1;
        }
        finally {
            $matchCache4.finish();
        }
    }
}
function isSent(value) {
    return ($is6 => {
        const $matchCache5 = $matchCache();
        try {
            return (typeof $is6 === "function" || typeof $is6 === "object") && $is6 !== null && $matchCache5.propertyHas($is6, "_tag") && $matchCache5.get($is6, "_tag") === "Sent";
        }
        catch (matchError_2) {
            $matchCache5.threw(matchError_2);
            throw matchError_2;
        }
        finally {
            $matchCache5.finish();
        }
    })(value);
}
export function main() {
    return Effect.sync({ main: () => { return [describe(Delivery.Waiting()), describe(Delivery.Sent({ tracking: "parcel-8" })), isSent(Delivery.Sent({ tracking: "x" })), isSent({ tracking: "x" })]; } }.main);
}
runtime.$entry(import.meta.main, import.meta.url, main, () => runtime.$runMain(main()));
