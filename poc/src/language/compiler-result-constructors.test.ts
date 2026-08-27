import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

/**
 * The compiler-owned Result variant constructors are not part of the authoring
 * surface, at any spelling that reaches them.
 *
 * specification/failures.mdx, "Compiler Lifting" (Locked): "Authors MUST NOT
 * need to write `Result.ok(...)` or `Result.err(...)`. Those constructors MUST
 * NOT be part of the ordinary Smithers authoring API."
 *
 * The hole this file closes was measured, executed, and printed both variants:
 * every compiler-intrinsic specifier resolves to the runtime index, the index
 * re-exports `__vsResultSuccess`, `__vsResultFailure` and `RuntimeValues`, and
 * so `import { __vsResultSuccess } from "smthrs/context"` let authored `.sm`
 * hand-build a Result that never came from a checked exit — with ZERO
 * diagnostics. `poc/src/runtime/values.ts` already documents the invariant this
 * violated: `RuntimeValues` "must never be re-exported under a name a Smithers
 * author could reach."
 *
 * The load-bearing half of this file is the second describe block. A rule that
 * refused everything from a compiler-owned module would satisfy every refusal
 * below while removing `Context`, `Layer` and `panic` from the language.
 */

const workspace = mkdtempSync(join(tmpdir(), "smithers-compiler-constructors-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

function check(files: readonly { readonly fileName: string; readonly source: string }[]) {
  return compileAndCheckProject(files.map((file) => ({ ...file, fileName: join(workspace, file.fileName) })), {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    outputExtension: ".ts",
    runtimeImport: RUNTIME,
    sourceMap: false,
  });
}

function codes(files: readonly { readonly fileName: string; readonly source: string }[]): readonly string[] {
  return check(files).result.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

describe("a compiler-owned Result constructor is unreachable from authored .sm", () => {
  // Every route measured on the fork, mirrored here: the same program must be
  // refused by both backends or the two languages are not one language.
  const routes: readonly (readonly [string, string])[] = [
    ["a direct import", `import { __vsResultSuccess } from "smthrs/context"\nexport function main(): string[] { return [typeof __vsResultSuccess] }\n`],
    ["both variants at once", `import { __vsResultSuccess, __vsResultFailure } from "smthrs/context"\nexport function main(): string[] { return [typeof __vsResultSuccess, typeof __vsResultFailure] }\n`],
    ["through smthrs/provider", `import { __vsResultFailure } from "smthrs/provider"\nexport function main(): string[] { return [typeof __vsResultFailure] }\n`],
    ["through smithers:exceptions", `import { __vsResultSuccess } from "smithers:exceptions"\nexport function main(): string[] { return [typeof __vsResultSuccess] }\n`],
    ["a renamed import", `import { __vsResultSuccess as build } from "smthrs/context"\nexport function main(): string[] { return [typeof build] }\n`],
    ["a re-export", `export { __vsResultFailure } from "smithers:exceptions"\nexport function main(): string[] { return ["x"] }\n`],
    ["a renamed re-export", `export { __vsResultSuccess as build } from "smithers:exceptions"\nexport function main(): string[] { return ["x"] }\n`],
    ["a namespace member read", `import * as Runtime from "smthrs/context"\nexport function main(): string[] { return [typeof Runtime.__vsResultSuccess] }\n`],
    ["the RuntimeValues namespace", `import { RuntimeValues } from "smthrs/context"\nexport function main(): string[] { return [typeof RuntimeValues] }\n`],
  ];

  for (const [name, source] of routes) {
    test(name, () => {
      expect(codes([{ fileName: `${name.replace(/[^a-z]+/gi, "-")}.sm`, source }])).toContain("SMITHERS1201");
    });
  }

  test("a re-export chain through a project module is refused where it names the constructor", () => {
    const diagnostics = check([
      { fileName: "chain-relay.sm", source: `export { __vsResultSuccess } from "smthrs/context"\n` },
      {
        fileName: "chain-main.sm",
        source: `import { __vsResultSuccess } from "./chain-relay.sm"\nexport function main(): string[] { return [typeof __vsResultSuccess] }\n`,
      },
    ]).result.diagnostics;
    const relay = diagnostics.filter((diagnostic) =>
      diagnostic.code === "SMITHERS1201" && (diagnostic.fileName ?? "").endsWith("chain-relay.sm")
    );
    expect(relay.length).toBe(1);
  });

  // The forgery this closes, spelled out: without the rule this program
  // compiled clean and printed both variants.
  test("the hand-built Result program no longer compiles", () => {
    expect(codes([{
      fileName: "forged.sm",
      source: `import { __vsResultSuccess, __vsResultFailure } from "smthrs/context"

export class Bad extends Error {}

export function main(): string[] {
  const ok: Result<string, Bad> = __vsResultSuccess("hand built success")
  const err: Result<string, Bad> = __vsResultFailure(new Bad("hand built failure"))
  return [ok.unwrapOr("x"), \`\${err.isError()}\`]
}
`,
    }])).toContain("SMITHERS1201");
  });
});

describe("everything the compiler-owned modules are FOR still works", () => {
  test("Context, Layer, panic and Panic remain importable and the program runs", () => {
    const checked = check([{
      fileName: "authoring-surface.sm",
      source: `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
import { panic } from "smithers:exceptions"

abstract class Clock extends Context {
  abstract now(): number
}

class FixedClock extends Clock {
  now(): number { return 1700000000000 }
}

export class Missing extends Error {
  constructor(readonly key: string) { super("missing " + key) }
}

function lookup(key: string): Result<string, Missing> {
  if (key !== "ada") throw new Missing(key)
  return "guest"
}

function refuse(): string {
  panic("a defect")
}

export function main(): string[] {
  const found = lookup("ada").match({ ok: (value) => value, error: (error) => error.message })
  const stamped = Layer.provide(Layer.succeed(Clock, new FixedClock()), () => \`at:\${Clock.context().now()}\`)
  const defect = Result.try(() => refuse()).match({ ok: () => "no defect", error: (failure) => "defect:" + failure.name })
  return [found, stamped, defect]
}
`,
    }]);
    expect(checked.result.diagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
  });

  // A type-only binding initializes nothing and constructs nothing, which is
  // the line every other module rule draws. Pinned so that narrowing it later
  // reads as a deliberate change.
  test("a type-only binding is left alone", () => {
    expect(codes([{
      fileName: "type-only.sm",
      source: `import type { __vsResultSuccess } from "smthrs/context"\nexport type Build = typeof __vsResultSuccess\nexport function main(): string[] { return ["ok"] }\n`,
    }])).not.toContain("SMITHERS1201");
  });

  // The rule is anchored on the compiler-intrinsic specifier registry, so an
  // author's own module exporting the same NAME is an ordinary value.
  test("an author's own binding of the same name is ordinary", () => {
    const diagnostics = check([
      { fileName: "own-relay.sm", source: `export function __vsResultSuccess(label: string): string { return "mine:" + label }\n` },
      {
        fileName: "own-main.sm",
        source: `import { __vsResultSuccess } from "./own-relay.sm"\nexport function main(): string[] { return [__vsResultSuccess("value")] }\n`,
      },
    ]).result.diagnostics;
    expect(diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1201")).toEqual([]);
  });

  // `Result.ok(...)` keeps its own SMITHERS1201 at its own spelling. The two
  // rules carry one specification sentence at two spellings; neither replaces
  // the other.
  test("Result.ok keeps its own SMITHERS1201", () => {
    expect(codes([{
      fileName: "result-ok.sm",
      source: `export function main(): string[] { return [String(Result.ok("x"))] }\n`,
    }])).toContain("SMITHERS1201");
  });
});
