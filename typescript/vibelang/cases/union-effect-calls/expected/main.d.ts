import * as $nativeTryEffect from "effect/Effect";
export declare function direct(flag: boolean): $nativeTryEffect.Effect<string | number, never, never>;
export declare function byName(flag: boolean): $nativeTryEffect.Effect<string | number, never, never>;
export declare function main(): $nativeTryEffect.Effect<(string | number)[], "refused", never>;
