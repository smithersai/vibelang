import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProject } from "./index.ts";

const RUNTIME = resolve(import.meta.dir, "../runtime/index.ts");

/**
 * Two modules declaring the same nominal Error/Context name must stay distinct
 * identities all the way through the runtime registration path, not just in the
 * analysis rows.
 */
test("same-named Errors in different modules keep distinct runtime identities", async () => {
  const library = (label: string) => `
    export class Duplicate extends Error {
      constructor() { super("duplicate from ${label}") }
    }
    export function fail(): Result<string, Duplicate> {
      throw new Duplicate()
    }
  `;
  const sources = [
    { fileName: "left.vibe", source: library("left") },
    { fileName: "nested/right.vibe", source: library("right") },
    {
      fileName: "main.vibe",
      source: `
        import { fail as failLeft, Duplicate as LeftDuplicate } from "./left.vibe"
        import { fail as failRight, Duplicate as RightDuplicate } from "./nested/right.vibe"

        function label(error: LeftDuplicate | RightDuplicate): string {
          return error.match({
            LeftDuplicate: () => "left",
            RightDuplicate: () => "right",
          })
        }

        export function classify(which: string): string {
          if (which === "left") {
            return failLeft().match({ ok: (value: string) => value, error: label })
          }
          return failRight().match({ ok: (value: string) => value, error: label })
        }

        export function instances(): unknown[] {
          return [new LeftDuplicate(), new RightDuplicate()]
        }
      `,
    },
  ];

  const root = await mkdtemp(join(tmpdir(), "vibe-qualified-rows-"));
  try {
    const compiled = compileProject(sources, {
      rootDir: root,
      outDir: root,
      outputExtension: ".mjs",
      sourceMap: false,
      runtimeImport: pathToFileURL(RUNTIME).href,
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.files["main.vibe"]!.analysis.rows.classify)
      .toEqual({ failures: [], requirements: [] });

    // The emitted registration keys are already module-qualified, which is the
    // identity the analysis rows now mirror.
    expect(compiled.files["left.vibe"]!.code).toContain('"vibe:left.vibe:Duplicate"');
    expect(compiled.files["nested/right.vibe"]!.code).toContain('"vibe:nested/right.vibe:Duplicate"');

    const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
    for (const file of Object.values(compiled.files)) {
      await mkdir(dirname(file.outputFileName), { recursive: true });
      await writeFile(file.outputFileName, transpiler.transformSync(file.code));
    }
    const module = await import(
      pathToFileURL(compiled.files["main.vibe"]!.outputFileName).href
    ) as Record<string, any>;

    // Both classes registered without an identity collision, and the nominal
    // cases select the right handler at runtime.
    expect(module.classify("left")).toBe("left");
    expect(module.classify("right")).toBe("right");

    // Read the registry through the exact runtime module instance the
    // generated modules registered into.
    const { errorIdentity } = await import(pathToFileURL(RUNTIME).href) as {
      errorIdentity: (error: unknown) => string | undefined;
    };
    const [left, right] = module.instances() as [Error, Error];
    // Registration would have thrown at import time on an identity collision;
    // both survive because the module qualifier separates them.
    expect(errorIdentity(left)).toBe("vibe:left.vibe:Duplicate");
    expect(errorIdentity(right)).toBe("vibe:nested/right.vibe:Duplicate");
    expect(left.constructor).not.toBe(right.constructor);
  } finally {
    await rm(root, { recursive: true });
  }
});
