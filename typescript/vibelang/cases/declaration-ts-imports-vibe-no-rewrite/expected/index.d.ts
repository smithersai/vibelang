export { find, NotFound } from "./User.ts";
export declare const lookup: (id: string) => import("effect/Effect").Effect<string, import("./User.ts").NotFound, never>;
export declare const later: () => Promise<typeof import("./User.ts")>;
