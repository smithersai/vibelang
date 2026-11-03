import { Cause } from "effect";
/** @throws {never} */
export declare function get(q: string): Promise<string>;
/** @throws {never} */
export declare function tagged(q: string): Promise<string>;
/**
 * Echoes q.
 * @throws {never}
 */
export declare function documented(q: string): Promise<string>;
/** @throws {never} */
export declare function overloaded(q: string): Promise<string>;
/** @throws {never} */
export declare function identityCause(q: Cause.Cause<never>): Promise<Cause.Cause<never>>;
/** @throws {never} */
export declare function defaultReject(q?: string): Promise<string>;
export { generator } from "./helpers.js";
