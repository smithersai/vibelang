import { Effect } from "effect";
export interface Tool {
    readonly arguments: ReadonlyArray<string>;
    readonly load: number;
}
export declare const argumentCount: (tool: Tool) => Effect.Effect<number, never, never>;
export declare const firstArgument: (tool?: Tool | undefined) => Effect.Effect<string, never, never>;
export declare const asRecord: (tool: Tool) => Effect.Effect<{
    arguments: number;
}, never, never>;
export declare const named: (tool: Tool) => Effect.Effect<number, never, never>;
