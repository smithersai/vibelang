import type * as Effect from "effect/Effect";
export interface NS {
    getByName: (name: string) => string;
    /** @throws {never} */
    safe(name: string): string;
}
export declare const ns: Effect.Effect<NS>;
export declare const holder: {
    readonly ns: Effect.Effect<NS>;
};
export declare const obj: NS;
