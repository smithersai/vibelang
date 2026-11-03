import type { Mode } from "conditional";
import type { Peer } from "./peer.js";
export declare const mode: Mode;
export declare const peer: Peer;
export declare const here: {
    /** @throws {never} */
    (): string;
};
export { ready } from "./peer.js";
