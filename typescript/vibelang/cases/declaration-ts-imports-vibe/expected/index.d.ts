export { find, NotFound } from "./User.ts";
export { prefix } from "./prefix.ts";
export type { NotFound as Missing } from "./User.ts";
export declare const lookup: (id: string) => import("effect/Effect").Effect<string, import("./User.ts").NotFound, never>;
export declare const later: () => Promise<typeof import("./User.ts")>;
