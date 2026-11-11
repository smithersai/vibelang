export { value as repeated } from "./src/user/user.js";
export { value as server } from "./src/server/user.js";
export declare const load: () => Promise<typeof import("./src/user/user.js")>;
export type Server = typeof import("./src/server/user.js");
