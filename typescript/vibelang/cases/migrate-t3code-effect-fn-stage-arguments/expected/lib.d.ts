import { Effect } from "effect";
export declare const inspect: (databasePath: string) => Effect.Effect<string, never, never>;
export declare const newestFileMtime: (directory: string) => Effect.Effect<import("effect/Option").Option<number>, never, never>;
export declare const snapshot: (origin: string, bearerToken: string) => Effect.Effect<string, never, never>;
export declare const startTurn: (turnInput: string, codexInput: number) => Effect.Effect<string, never, never>;
export declare const verify: (proof: string | undefined, header: string) => Effect.Effect<string, never, never>;
export declare const lookup: (name: string) => Effect.Effect<number, never, never>;
