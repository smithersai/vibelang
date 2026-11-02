import { Context } from "effect";
export type Shape = {
    readonly value: string;
};
declare const Port_base: Context.ServiceClass<Port, "probe/Port", Shape>;
declare class Port extends Port_base {
}
export type Implementation = Context.Service.Shape<typeof Port>;
export {};
