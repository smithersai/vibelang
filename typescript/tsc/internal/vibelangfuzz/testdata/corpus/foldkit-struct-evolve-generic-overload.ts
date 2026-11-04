import { Struct } from "effect";
type Transform<O> = Partial<{ [K in keyof O]: (a: O[K]) => O[K] }>;
export const direct: { <O, const T extends Transform<O>>(o: O, t: T): unknown } = Struct.evolve;
