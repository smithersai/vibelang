/**
 * The Go fork backend: `cmd/smithersc-go --request` against the pinned,
 * digest-verified, forkpatch-applied smithersai/TypeScript checkout, in
 * protocol-v3 `lowering: "internal"` mode.
 *
 *   authored `.sm`
 *     -> one CompileRequest with `lowering: "internal"`
 *     -> the fork's own parser/checker/printer plus the Go Smithers lowering
 *     -> emitted JavaScript executed by node through the shared harness
 *
 * `lowering: "internal"` is deliberate: it is the migration target. The
 * `"external"` mode that `scripts/fork-e2e.mjs` drives would measure the JS
 * instrument again, only with the fork as a back end, and could never show
 * whether the Go implementation has the semantics.
 *
 * Wiring (bridge build, request shape, artifact decoding) follows
 * `scripts/fork-e2e.mjs`, which is imported here rather than reimplemented.
 */

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildBridgeBinary, locateForkCheckout } from "../../scripts/fork-e2e.mjs";
import { comptimeTarget, loweringMode, lineColumnOf } from "./corpus.mjs";
import { harnessText } from "./harness.mjs";
import { run, mapPool } from "./process.mjs";
import { splitLines } from "./backend-js.mjs";

/**
 * This backend's compiler-stable Error identity accessor, for the shared
 * harness's failure line.
 *
 * The fork injects `__smithers_prelude.ts` into every internally lowered
 * project and emits it beside the program, and a root-level emitted module
 * imports it as `./__smithers_prelude.js` — so the harness, which is written
 * into the same emit directory as the entry module, names it the same way and
 * reads the registry the emitted `smithersRegisterError` calls populated. See
 * `conformance/runner/harness.mjs`.
 */
const identityAccessor = { module: "./__smithers_prelude.js", name: "smithersErrorIdentity" };

export const goBackend = {
  name: "go",
  label: "Go fork + verified forkpatch series (cmd/smithersc-go, lowering: internal)",
  /**
   * The fork checks the authored `.sm` directly, so its "compile" stage is both
   * the language check and the emitted-code check; there is no separate emit
   * pass to skip. `conformance/runner/judge.mjs` audits every satisfied
   * expectation against these.
   */
  requiredStages: {
    output: ["compile", "execute"],
    diagnostics: ["compile"],
  },
  emitCheckStage: "compile",
};

/**
 * Resolve the pinned checkout, build the bridge once, and return a context the
 * per-case runner reuses. `undefined` means the backend is unavailable, with a
 * skip reason a human can act on.
 */
export async function prepareGoBackend({ forkCheckout } = {}) {
  const checkout = forkCheckout ?? (await locateForkCheckout());
  if (!checkout || !existsSync(checkout)) {
    return {
      unavailable:
        "the pinned smithersai/TypeScript checkout is absent; run `node scripts/prepare-typescript-fork.mjs --fetch --cache /private/tmp/smithers-ts-fork-cache` or point SMITHERS_TYPESCRIPT_FORK at a checkout",
    };
  }
  const go = await run("go", ["version"]);
  if (go.error || go.status !== 0) return { unavailable: "go is required to build the fork bridge" };
  const node = await run(process.execPath, ["--version"]);
  if (node.error || node.status !== 0) return { unavailable: "node is required to execute the fork's emitted JavaScript" };

  const workspace = await mkdtemp(join(tmpdir(), "smithers-conformance-go-"));
  let binary;
  try {
    binary = buildBridgeBinary(join(workspace, "bin"), {});
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    return { unavailable: `could not build cmd/smithersc-go: ${error.message}` };
  }
  const context = {
    checkout,
    binary,
    workspace,
    cache: join(workspace, "fork-cache"),
    async dispose() {
      await rm(workspace, { recursive: true, force: true });
    },
  };
  // Prepare the real compiler before scheduling cases. NewPinnedFork verifies
  // the exact revision and every pre/post-image gate, applies an entirely
  // pristine series, rejects mixed state, builds the series-keyed bridge, and
  // performs its revision+series handshake. Treat any failure here as backend
  // unavailability instead of manufacturing one misleading result per case.
  const probeDirectory = await mkdtemp(join(tmpdir(), "smithers-conformance-go-probe-"));
  try {
    const invoked = await invokeBridge(
      context,
      {
        rootNames: ["__forkpatch_probe.ts"],
        files: [
          {
            path: "__forkpatch_probe.ts",
            kind: "typescript",
            text: "export const forkpatchReady: number = 1;\n",
          },
        ],
        options: {},
        lowering: loweringMode,
      },
      probeDirectory,
    );
    const errors = (invoked.result?.diagnostics ?? []).filter((item) => item.category === "error");
    if (invoked.rejected || !invoked.result || errors.length > 0 || invoked.result.emitSkipped === true) {
      const reason =
        (invoked.rejected ?? errors.map((item) => `${item.code}: ${item.message}`).join("; ")) ||
        "probe emit was skipped";
      await context.dispose();
      return { unavailable: `forkpatch-backed Go bridge preparation failed: ${reason}` };
    }
  } catch (error) {
    await context.dispose();
    return { unavailable: `forkpatch-backed Go bridge preparation failed: ${error.message}` };
  } finally {
    await rm(probeDirectory, { recursive: true, force: true });
  }
  return context;
}

/**
 * The wire `kind` for one staged file.
 *
 * The protocol has a third kind — `FileKindAsset` is declared in
 * `compiler/api.go` — but the bridge's own switch accepts only `"smithers"` and
 * `"typescript"` and errors on anything else, and an errored request is a
 * *rejected* request, which the judge scores `unmeasured`: a failure to measure,
 * not a measurement. So an asset goes over the wire under the only kind the
 * bridge accepts for a file that is not `.sm`, at the same path and with the
 * same bytes the JS backend staged, and is deliberately left out of `rootNames`.
 *
 * The consequence is the honest one: the fork has no source-asset pass, so it
 * cannot resolve `./config.json` and reports a stock TypeScript code, which the
 * judge classifies as `unsupported` — "no rule of its own here yet". What must
 * not happen is the harness quietly staging a *different* project for the fork
 * than for the reference, which is why the file is sent at all.
 */
function forkFileKind(file) {
  return file.kind === "asset" ? "typescript" : file.kind;
}

async function invokeBridge(context, request, directory) {
  const requestPath = join(directory, "request.json");
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  const invoked = await run(
    context.binary,
    ["--fork-checkout", context.checkout, "--fork-cache", context.cache, "--timeout", "5m", "--request", requestPath],
    { cwd: dirname(context.binary), timeout: 300_000 },
  );
  if (invoked.error) return { rejected: `could not run the bridge binary: ${invoked.error.message}` };
  if (invoked.status === 64 || invoked.stdout.trim() === "") {
    return { rejected: `smithersc-go rejected the request (exit ${invoked.status}): ${invoked.stderr.trim().slice(0, 400)}` };
  }
  try {
    return { result: JSON.parse(invoked.stdout) };
  } catch {
    return { rejected: `smithersc-go did not return one CompileResult: ${invoked.stdout.slice(0, 400)}` };
  }
}

/**
 * Compile and, for a clean compile, execute one case through the pinned fork.
 *
 * Returns the same observation shape as the JS backend, plus `kind: "rejected"`
 * for a request the bridge would not even accept.
 */
export async function runGoCase(context, testCase) {
  const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-go-case-"));
  try {
    const request = {
      // A staged asset is a project input, not a compilation root: nothing
      // should be checked or emitted *from* `config.json`. The authored `.sm`
      // that imports it is the root.
      rootNames: testCase.files.filter((file) => file.kind !== "asset").map((file) => file.path),
      files: testCase.files.map((file) => ({ path: file.path, kind: forkFileKind(file), text: file.text })),
      // Sent explicitly, from the one constant the JS driver also reads. An
      // omitted `comptimeTarget` lets the bridge fall back to its own default,
      // which is not the reference's, and a target-selected comptime branch
      // then folds a different constant into each backend's emitted program
      // with no diagnostic on either side. See `comptimeTarget` in corpus.mjs.
      options: { comptimeTarget },
      // Sent explicitly, from the one constant in corpus.mjs, for the same
      // reason `comptimeTarget` is: an omitted `lowering` is a mode the corpus
      // cannot observe. It used to select the stock TypeScript checker and no
      // Smithers rule at all. `conformance/runner/selftest.mjs` holds that
      // assertion, because no corpus case ever reaches this branch.
      lowering: loweringMode,
    };
    const invoked = await invokeBridge(context, request, directory);
    if (invoked.rejected) return { kind: "rejected", stages: [], reason: invoked.rejected };
    const result = invoked.result;

    const byPath = new Map(testCase.files.map((file) => [file.path, file.text]));
    const errors = (result.diagnostics ?? []).filter((item) => item.category === "error");
    if (errors.length > 0) {
      return {
        kind: "diagnostics",
        stage: "compile",
        stages: ["compile"],
        diagnostics: errors.map((item) => {
          const text = byPath.get(item.file);
          const position = text && item.span ? lineColumnOf(text, item.span.start) : { line: 0, column: 0 };
          return { code: item.code, file: item.file, ...position, message: item.message };
        }),
      };
    }

    const emitDirectory = join(directory, "out");
    await mkdir(emitDirectory, { recursive: true });
    for (const artifact of result.artifacts ?? []) {
      const destination = join(emitDirectory, artifact.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(artifact.content ?? "", "base64"));
    }
    await writeFile(join(emitDirectory, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
    const entryModule = `./${testCase.entry.replace(/\.sm$/, ".js")}`;
    await writeFile(join(emitDirectory, "conformance-harness.mjs"), harnessText(entryModule, identityAccessor));

    const executed = await run(process.execPath, [join(emitDirectory, "conformance-harness.mjs")], {
      cwd: emitDirectory,
    });
    if (executed.error) {
      return { kind: "error", stages: ["compile"], reason: `could not execute with node: ${executed.error.message}` };
    }
    return {
      kind: "output",
      stages: ["compile", "execute"],
      stdout: splitLines(executed.stdout),
      stderr: executed.stderr,
      exitCode: executed.status,
      emitSkipped: result.emitSkipped === true,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Send one plain-TypeScript interop file through the fork and run the emit. */
export async function runGoInterop(context, interopCase) {
  const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-go-interop-"));
  try {
    const request = {
      rootNames: [interopCase.entry],
      files: [{ path: interopCase.entry, kind: "typescript", text: interopCase.text }],
      options: {},
      lowering: loweringMode,
    };
    const invoked = await invokeBridge(context, request, directory);
    if (invoked.rejected) return { kind: "rejected", stages: [], reason: invoked.rejected };
    const result = invoked.result;
    const errors = (result.diagnostics ?? []).filter((item) => item.category === "error");
    if (errors.length > 0) {
      return {
        kind: "diagnostics",
        stage: "compile",
        stages: ["compile"],
        diagnostics: errors.map((item) => ({ code: item.code, file: item.file, message: item.message })),
      };
    }
    const emitDirectory = join(directory, "out");
    await mkdir(emitDirectory, { recursive: true });
    for (const artifact of result.artifacts ?? []) {
      const destination = join(emitDirectory, artifact.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(artifact.content ?? "", "base64"));
    }
    await writeFile(join(emitDirectory, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
    const executed = await run(process.execPath, [join(emitDirectory, interopCase.entry.replace(/\.ts$/, ".js"))], {
      cwd: emitDirectory,
    });
    if (executed.error) {
      return { kind: "error", stages: ["compile"], reason: `could not execute with node: ${executed.error.message}` };
    }
    return {
      kind: "output",
      stages: ["compile", "execute"],
      stdout: splitLines(executed.stdout),
      stderr: executed.stderr,
      exitCode: executed.status,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export { mapPool };
