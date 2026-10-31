import assert from "node:assert/strict";
import { main } from "knip";
import { createOptions } from "knip/session";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import fc from "fast-check";
import { checkProperty } from "../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../scripts/testing/spec-path.mjs";

const quote = "linters, Knip, bundlers and test runners each read `.vibe`.";
const counterpartQuote =
  "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.";
const compiler = new URL("../knip.mjs", import.meta.url).href;
const regressions = new URL("./property-regressions/", import.meta.url);
const propertyName = "KnipPublicJSDoc";
const forms = [
  "variable",
  "function",
  "class",
  "interface",
  "type",
  "multi-binding",
];
const layouts = [
  "direct",
  "blank",
  "ordinary-before",
  "ordinary-after",
  "second-jsdoc",
  "line-after",
  "inline-after",
  "crlf-after",
  "inline",
];

function program(input) {
  if (input.fixture === "t3code-knip-public-make")
    return "/** @public */\nexport const make = (): number => 1;\nexport const layer = make();\n";
  const { form, name, layout, public: marked } = input;
  const doc = marked ? "/** @public */" : "/** An ordinary description. */";
  const prefix = {
    direct: doc + "\n",
    blank: doc + "\n\n",
    "ordinary-before": "// Earlier comment\n" + doc + "\n",
    "ordinary-after": doc + "\n/* An adjacent comment. */\n",
    "second-jsdoc": doc + "\n/** More documentation. */\n",
    "line-after": doc + "\n// An adjacent line comment.\n",
    "inline-after": doc + " /* An adjacent inline comment. */\n",
    "crlf-after": doc + "\r\n/* An adjacent CRLF comment. */\r\n",
    inline: doc + " ",
  }[layout];
  const declaration = {
    variable: "export const " + name + " = (): number => 1;",
    function: "export function " + name + "(): number { return 1 }",
    class: "export class " + name + " { value = 1 }",
    interface: "export interface " + name + " { value: number }",
    type: "export type " + name + " = { value: number };",
    "multi-binding": "export const " + name + " = 1, " + name + "Other = 2;",
  }[form];
  const separators = {
    lf: "\n",
    cr: "\r",
    crlf: "\r\n",
    ls: "\u2028",
    ps: "\u2029",
  };
  const before = input.before
    ? "const before = 0;" + separators[input.lineTerminator]
    : "";
  return before + prefix + declaration + "\nexport const layer = 1;\n";
}
async function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-knip-public-"));
  const source = program(input);
  if (input.source !== undefined)
    assert.equal(input.source, source, "consume the literal migration witness");
  const sides = [];
  try {
    for (const extension of ["ts", "vibe"]) {
      const cwd = join(root, extension);
      mkdirSync(cwd);
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "knip-public-" + extension,
          private: true,
          type: "module",
        }),
      );
      writeFileSync(join(cwd, "lib." + extension), source);
      writeFileSync(
        join(cwd, "entry.ts"),
        'import {layer} from "./lib.' + extension + '"; console.log(layer);\n',
      );
      writeFileSync(
        join(cwd, "knip.config.ts"),
        "import compile from " +
          JSON.stringify(compiler) +
          '; export default {entry:["entry.ts"],project:["entry.ts","lib.ts","lib.vibe"],compilers:{vibe:compile}};\n',
      );
      const options = await createOptions({
        cwd,
        args: { exports: true, "no-config-hints": true },
      });
      options.isShowProgress = false;
      assert.ok(
        options.configFilePath?.endsWith("knip.config.ts"),
        "Knip must use the fixture configuration",
      );
      const result = await main(options);
      assert.ok(
        result.counters.processed >= 2,
        "Knip must analyze the entry and library",
      );
      sides.push(
        ["exports", "types"]
          .flatMap((section) =>
            Object.entries(result.issues[section] ?? {}).flatMap(
              ([file, items]) =>
                Object.values(items).map(
                  (item) =>
                    section +
                    ":" +
                    basename(file).replace(/\.vibe$/, ".ts") +
                    ":" +
                    item.symbol,
                ),
            ),
          )
          .sort(),
      );
    }
    const [expected, actual] = sides;
    assert.deepEqual(actual, expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T3code: Knip preserves public JSDoc and its native attachment rules", async () => {
  for (const [chapter, text] of [
    ["007-tooling.md", quote],
    ["000-intro.md", counterpartQuote],
  ]) {
    assert.ok(
      readFileSync(SpecPath(chapter), "utf8").includes(text),
      "update the Knip counterpart oracle",
    );
  }
  await checkProperty(fc, {
    name: propertyName,
    rule: "Chapter0/7: actual Knip analysis preserves public JSDoc using the native TypeScript attachment rule.",
    command: "node --test packages/compiler/test/knip-public.property.test.mjs",
    regressions,
    numRuns: 240,
    arbitrary: fc.record({
      form: fc.constantFrom(...forms),
      layout: fc.constantFrom(...layouts),
      name: fc.integer({ min: 0, max: 999 }).map((i) => "make" + i),
      public: fc.boolean(),
      before: fc.boolean(),
      lineTerminator: fc.constantFrom("lf", "cr", "crlf", "ls", "ps"),
    }),
    check: verify,
  });
});
