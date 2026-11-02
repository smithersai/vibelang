import { Context } from "effect";
export type Shape = { readonly value: string };
class Port extends Context.Service<Port, Shape>()("probe/Port") {}
export type Implementation = Context.Service.Shape<typeof Port>;
