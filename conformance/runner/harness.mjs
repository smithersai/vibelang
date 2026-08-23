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
 * comparable across the two implementations; nothing here normalizes the
 * *semantics* under test.
 */

export const HARNESS_BODY = `
function describeError(error) {
  const name = error && error.constructor && error.constructor.name ? error.constructor.name : String(error);
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

/** Build the harness module text for one entry specifier. */
export function harnessText(entrySpecifier) {
  return `import * as program from ${JSON.stringify(entrySpecifier)};\n${HARNESS_BODY}`;
}
