import * as Plain from "./out/plain.js"
import * as Generic from "./out/generic.js"
const plain: Plain.as = Plain.as.Value()
const generic: Generic.as<number> = Generic.as.Value({value: 1})
const tag: "Value" = plain._tag
const value: number = generic.value
void [tag, value]
