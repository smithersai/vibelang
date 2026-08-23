/**
 * Trusted host boundary for the fork end-to-end fixtures.
 *
 * `.sm` refuses ambient host globals (`SMITHERS1601`), so observable output goes
 * through an ordinary foreign TypeScript module whose leading JSDoc carries the
 * module-initialization trust claim the frontend requires (`SMITHERS1510`).
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function print(line: string): void {
  console.log(line);
}
