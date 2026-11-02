// @effect-diagnostics nodeBuiltinImport:off -- approved existing TypeScript platform boundary
import { existsSync } from "node:fs";
import * as Schema from "./Schema.ts";
const Shape = Schema.String;
export type Shape = typeof Shape.Type;
const decode = Schema.decodeSync(Shape);
export function read(path: string): Shape { existsSync(path); return decode('"x"'); }
