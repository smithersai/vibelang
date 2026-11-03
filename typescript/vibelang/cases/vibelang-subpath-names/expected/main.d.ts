import { Effect } from "effect";
import { ChildProcess } from "effect/process";
/** @throws {never} */
export declare function encoded(bytes: Uint8Array): string;
export declare const command: ChildProcess.Command;
export declare function main(): Effect.Effect<{
    hex: string;
    command: "PipedCommand" | "StandardCommand";
    headers: string | null;
    local: string;
    adjust: "bigint" | "boolean" | "function" | "number" | "object" | "string" | "symbol" | "undefined";
}, never, never>;
