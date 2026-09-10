import { run, releaseAssetAnswer } from "../compiled-project/main.mjs";
import { load, type Missing } from "../compiled-project/service.mjs";
import type { ResultType } from "vibelang/runtime";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// These reject an unresolved alias, `any`, or an erased success/error channel.
export type MainResult = Assert<Equal<ReturnType<typeof run>, ResultType<string, Missing>>>;
export type ServiceResult = Assert<Equal<ReturnType<typeof load>, ResultType<string, Missing>>>;
export type AssetLiteral = Assert<Equal<typeof releaseAssetAnswer, 42>>;

run().match({
  ok(value) {
    const text: string = value;
    // @ts-expect-error the successful value is not a number
    const number: number = value;
    return text;
  },
  error(error) {
    const missing: Missing = error;
    // @ts-expect-error the nominal error channel must not disappear
    const impossible: never = error;
    return missing.message;
  },
});
