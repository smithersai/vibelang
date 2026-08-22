/**
 * Trusted host boundary for the fork end-to-end fixtures.
 *
 * `.vibe` refuses ambient host globals (`VIBE1601`), so observable output goes
 * through an ordinary foreign TypeScript module whose leading JSDoc carries the
 * module-initialization trust claim the frontend requires (`VIBE1510`).
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function print(line: string): void {
  console.log(line);
}
