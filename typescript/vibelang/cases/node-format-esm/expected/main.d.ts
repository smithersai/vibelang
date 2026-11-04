import type { Mode } from "conditional";
import type { Peer } from "./peer.js";
export declare const mode: Mode;
export declare const peer: Peer;
/** @throws {never} */
export declare const here: () => string;
export { ready } from "./peer.js";
