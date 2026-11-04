import { Effect } from "effect";
type Outcome = {
    readonly kind: "ok";
    readonly value: number;
};
export declare const observed: number[];
export declare const event: (bad: boolean) => Effect.Effect<Outcome, string, never>;
export declare const clock: () => Effect.Effect<Outcome, never, never>;
export {};
