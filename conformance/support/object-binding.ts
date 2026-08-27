/**
 * A trusted binding whose two exports sit on opposite sides of the residual
 * foreign-value wall.
 *
 * `specification/compatibility.mdx`, "Foreign Boundary": "Trusted
 * `@throws {never}` metadata opts out" of the default checked panic case. That
 * claim is about the **call**. The *value* a trusted call returns is still
 * foreign, and returning an executable foreign value out of `.sm` loses its
 * panic provenance — which `SMITHERS1508` refuses.
 *
 * `environmentNamesArray` returns an object, so a `.sm` function that returns
 * its result is refused. `fillBytes` writes into a buffer `.sm` already owns
 * and returns nothing, which is the spelling that works today and costs one
 * line. Both directions are pinned, so whichever way the open question about
 * `SMITHERS1508`'s object-return wall is settled, the corpus records the state
 * it was settled from.
 *
 * @module
 * @throws {never}
 */

/** A trusted call whose RETURNED VALUE is a foreign object.
 * @throws {never}
 */
export function environmentNamesArray(): readonly string[] {
  return ["a", "b"];
}

/** A trusted call that writes into a Smithers-owned buffer and returns nothing.
 * @throws {never}
 */
export function fillBytes(target: Uint8Array): void {
  for (let index = 0; index < target.length; index++) target[index] = index + 1;
}
