import { Chunk, Effect, FileSystem as FileSystem_1, Option } from "effect";
import { Prompt } from "effect/ai";
export declare function firstOr(values: Chunk.Chunk<number>, fallback: number): Option.Option<number>;
export declare const spelled: (value: Option.Option<number>) => number;
export declare const promptAst: () => Effect.Effect<"Any" | "Arrays" | "BigInt" | "Boolean" | "Declaration" | "Enum" | "Literal" | "Never" | "Null" | "Number" | "ObjectKeyword" | "Objects" | "String" | "Suspend" | "Symbol" | "TemplateLiteral" | "Undefined" | "Union" | "UniqueSymbol" | "Unknown" | "Void", never, never>;
export declare function prompt(text: string): Prompt.Prompt;
export declare function implementation(files: FileSystem_1.FileSystem): Effect.Effect<FileSystem_1.FileSystem, never, never>;
export declare function main(): Effect.Effect<(number | "Any" | "Arrays" | "BigInt" | "Boolean" | "Declaration" | "Enum" | "Literal" | "Never" | "Null" | "Number" | "ObjectKeyword" | "Objects" | "String" | "Suspend" | "Symbol" | "TemplateLiteral" | "Undefined" | "Union" | "UniqueSymbol" | "Unknown" | "Void" | "assistant" | "system" | "tool" | "user")[], never, never>;
