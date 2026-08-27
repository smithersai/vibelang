/**
 * The observation apparatus both backends share.
 *
 * A conformance output case exports `main`, returning `string[]` or
 * `Result<string[], E>` (optionally as a Promise). The two backends represent a
 * Result differently at runtime — the JS instrument returns the POC runtime's
 * `ResultValue` (a `match` method, private state), while the Go fork's internal
 * lowering returns its prelude's `SmithersOk`/`SmithersErr` (a public `ok` tag) — so this
 * harness normalizes both to the same printed lines. Normalizing the
 * *representation* is what makes a single declared expectation legitimately
 * comparable across two implementations; nothing here normalizes the
 * *semantics* under test.
 *
 * ## Why a failure line prints an identity rather than a class name
 *
 * Until 2026-08-25 `describeError` printed `error.constructor.name`. That is a
 * defensible thing to print and an indefensible thing to *observe*, for a
 * reason the specification states outright:
 *
 *   specification/failures.mdx, "Error Prototype" — "Handler selection MUST use
 *   compiler-stable nominal identity, not a forgeable user `_tag` or
 *   minifier-sensitive constructor name in compiled artifacts."
 *
 * The corpus was reading exactly the thing that sentence names as the wrong
 * key. The consequence was not cosmetic. `failures.mdx`'s "Error Classes"
 * sentence puts four obligations on the compiler — stable nominal identity,
 * matching metadata, serialization evidence, and cross-realm transport metadata
 * — and until 2026-08-25 the Go fork implemented exactly one of them. **No
 * corpus case could see that**, in either direction, because no case observed
 * an identity: `error.constructor.name` is `Boom` on a backend that mints an
 * identity and `Boom` on a backend that mints none. A gap the contract cannot
 * express is a gap that reopens silently, which is why this is a harness change
 * and not a corpus case.
 *
 * So each backend hands the harness *its own* identity accessor and the failure
 * line carries the compiler-stable identity:
 *
 *   js  `errorIdentity`          from the POC runtime the emitted program imports
 *   go  `smithersErrorIdentity`  from the `__smithers_prelude.js` it emits
 *
 * Both are read from the same module instance the program itself registered
 * into — the JS backend's absolute `runtimeImport` and the fork's own relative
 * prelude specifier — so the accessor sees the live registry rather than a
 * second, empty copy of it. This is the same normalization the Result
 * representation already gets: two implementations, two spellings of one
 * concept, one declared expectation. Nothing about the identity *value* is
 * normalized — that value is the thing under test, and the two backends have to
 * mint it identically to satisfy one `stdout` line.
 *
 * An error the compiler never registered has no identity, and the line falls
 * back to the constructor name it used to print. That fallback cannot make a
 * declaring case pass by accident: every identity contains a `:` and no
 * constructor name does, so the two spellings can never collide.
 */

const HARNESS_PROLOGUE = `
function describeError(error) {
  const identity = __smithersIdentityOf(error);
  const name =
    typeof identity === "string" && identity.length > 0
      ? identity
      : error && error.constructor && error.constructor.name
        ? error.constructor.name
        : String(error);
  const message = error && typeof error.message === "string" ? error.message : "";
  return message.length > 0 ? "error " + name + ": " + message : "error " + name;
}

function normalize(value) {
  if (Array.isArray(value)) return value.map((line) => String(line));
  if (value !== null && typeof value === "object") {
    if (typeof value.match === "function") {
      return value.match({ ok: (inner) => normalize(inner), error: (failure) => [describeError(failure)] });
    }
    if (typeof value.ok === "boolean") {
      return value.ok ? normalize(value.value) : [describeError(value.error)];
    }
  }
  throw new Error("conformance main() must return string[] or Result<string[], E>, got " + String(value));
}

const produced = await program.main();
for (const line of normalize(produced)) console.log(line);
`;

/**
 * Build the harness module text for one entry specifier.
 *
 * `identityAccessor` is `{ module, name }` naming the backend's own
 * compiler-stable Error identity function, and it is **required**. A default
 * would be the shape of defect `conformance/runner/selftest.mjs` exists for: a
 * backend that quietly stopped supplying one would fall back to the
 * constructor name for every case at once, and every case that does not declare
 * an identity would stay green while the observation silently weakened.
 */
export function harnessText(entrySpecifier, identityAccessor) {
  if (
    identityAccessor === null ||
    typeof identityAccessor !== "object" ||
    typeof identityAccessor.module !== "string" ||
    identityAccessor.module.length === 0 ||
    typeof identityAccessor.name !== "string" ||
    identityAccessor.name.length === 0
  ) {
    throw new Error("harnessText needs the backend's Error identity accessor as { module, name }");
  }
  return [
    `import * as program from ${JSON.stringify(entrySpecifier)};`,
    `import { ${identityAccessor.name} as __smithersIdentityOf } from ${JSON.stringify(identityAccessor.module)};`,
    HARNESS_PROLOGUE,
  ].join("\n");
}
