import { Context } from "effect";
export type Shape = { readonly value: string };
export class Port extends Context.Service<Port, Shape>()("probe/Port") {}
export type Implementation = Context.Service.Shape<typeof Port>;
export class Prefix extends Context.Service<Prefix, string>()("probe/Prefix") {}
export class Tuple extends Context.Service<Tuple, readonly [string, number]>()("probe/Tuple") {}
export class Fn extends Context.Service<Fn, (n: number) => string>()("probe/Fn") {}
export type Union = string | number;
export class Choice extends Context.Service<Choice, Union>()("probe/Choice") {}
export const Flags = Context.Reference<Shape>("probe/Flags", { defaultValue: () => ({ value: "yes" }) })
export const Counter = Context.Reference<number>("probe/Counter", { defaultValue: () => 4 })
export type DefaultShape = Context.Service.Shape<typeof Flags>;
export class Legacy extends Context.Service<Legacy, { readonly value: string }>()("probe/Legacy") {}
export namespace Legacy { export type Shape = { readonly value: string } }
