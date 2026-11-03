import type { Shape } from "./shapes.ts";
export { twice as double } from "./more.ts";
export * as moreModule from "./more.ts";
export declare enum Mode {
    Trim = 0,
    Upper = 1
}
export declare function clean(value: string, mode?: Mode): string;
export declare function area(shape: Shape): number;
declare const label = "more:";
export { label as prefix };
export default class {
    count: number;
    increment(): number;
}
