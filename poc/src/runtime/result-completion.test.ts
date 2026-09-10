import { expect, test } from "bun:test";
import { __vsCompleteResult, __vsResultFailure, __vsResultSuccess, type Result } from "./result.ts";
import { __vsRunResult, __vsRunResultAsync } from "./effect.ts";
import { Panic } from "./panic.ts";

const message = "a function with a non-empty failure row completed without a Result";
const success = __vsResultSuccess(7);
const failure = __vsResultFailure(new Error("missing"));

for (const [name, value] of [["success", success], ["failure", failure]] as const) {
  test(`non-suspending completion preserves ${name} identity`, () => {
    expect(__vsCompleteResult(value)).toBe(value);
  });
}

for (const [name, value] of Object.entries({
  undefined: undefined, null: null, primitive: 7, shape: { ok: true, value: 7 },
  prototype: Object.create(Object.getPrototypeOf(success)),
  clone: { ...success }, proxy: new Proxy(success, {}),
})) {
  test(`all completion drivers reject a foreign ${name} with the same panic`, async () => {
    const forged = value as Result<number, Error>;
    const fast = () => __vsCompleteResult(forged);
    expect(fast).toThrow(Panic);
    expect(fast).toThrow(message);
    expect(() => __vsRunResult(function* () { return forged; })).toThrow(message);
    await expect(__vsRunResultAsync(async function* () { return forged; })).rejects.toThrow(message);
  });
}
