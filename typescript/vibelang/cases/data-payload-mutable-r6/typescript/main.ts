import { Data } from "effect";
export type Payload = Data.TaggedEnum<{
    Item: {
        nested: {
            count: number;
        };
        values: number[];
        readonlyNested: {
            readonly count: number;
        };
        dictionary: { [key: string]: number };
    };
}>;
export const Payload = Data.taggedEnum<Payload>();
export function mutate(value: Payload): number[] {
    value.nested.count++;
    value.dictionary["count"] = value.nested.count;
    value.values.push(value.nested.count);
    return [value.nested.count, value.values.length];
}
