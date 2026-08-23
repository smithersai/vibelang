import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The Go backend drives a repository-only toolchain: `compiler/` and `cmd/` are
// deliberately not part of the published package, so this module cannot work
// from an installed tarball. The root is therefore resolved lazily through path
// APIs rather than a relative `new URL(...)` edge — a packaged module must not
// carry a static runtime edge that escapes the package — and callers get an
// explicit failure instead of a confusing missing-file error.
function repositoryRootOrThrow(): string {
  const candidate = resolve(import.meta.dirname, "..");
  if (!existsSync(join(candidate, "compiler", "forkpatch", "forkpatch.mjs"))) {
    throw new Error(
      "the Go backend requires a Smithers repository checkout: `compiler/` and `cmd/` are not " +
        "shipped in the published package, so `--backend go` is unavailable here. Run it from a " +
        "repository checkout, or use the default `--backend js`.",
    );
  }
  return candidate;
}

const DEFAULT_FORK_CACHE = "/private/tmp/smithers-ts-fork-cache";
const GO_PROCESS_BUFFER = 128 * 1024 * 1024;

export interface GoBackendSourceFile {
  readonly path: string;
  readonly kind: "smithers" | "typescript";
  readonly text: string;
}

export interface GoBackendDiagnostic {
  readonly code: string;
  readonly category: "error" | "warning" | "suggestion" | "message";
  readonly message: string;
  readonly file?: string;
  readonly span?: {
    readonly start: number;
    readonly length: number;
  };
  readonly phase?: "parse" | "bind" | "check" | "lower" | "emit" | "comptime";
}

export interface GoBackendArtifact {
  readonly path: string;
  readonly content: string;
}

export interface GoBackendCompileResult {
  readonly diagnostics: readonly GoBackendDiagnostic[];
  readonly artifacts: readonly GoBackendArtifact[];
  readonly emitSkipped: boolean;
}

export interface GoBackendRequest {
  readonly rootNames: readonly string[];
  readonly files: readonly GoBackendSourceFile[];
  readonly options: Readonly<Record<string, boolean | string>>;
  readonly lowering: "internal";
}

/** A stable product-facing failure code plus the command that repairs it. */
export class GoBackendFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoBackendFailure";
    this.code = code;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function detail(stdout: string | null | undefined, stderr: string | null | undefined): string {
  return (stderr?.trim() || stdout?.trim() || "no process output").slice(0, 16_384);
}

function pinnedRevision(): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(repositoryRootOrThrow(), "typescript-fork.json"), "utf8"));
  } catch (error) {
    throw new GoBackendFailure(
      "SMITHERS_GO_INSTALLATION",
      `The Go backend cannot read typescript-fork.json: ${error instanceof Error ? error.message : String(error)}. ` +
      "Remedy: run `npm run build` from a complete Smithers source checkout.",
    );
  }
  const revision = parsed !== null && typeof parsed === "object" && "revision" in parsed
    ? (parsed as { revision?: unknown }).revision
    : undefined;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new GoBackendFailure(
      "SMITHERS_GO_INSTALLATION",
      "The Go backend found an invalid typescript-fork.json. Remedy: run `npm run build` from a complete Smithers source checkout.",
    );
  }
  return revision;
}

function checkoutPreparationCommands(revision: string, cache = DEFAULT_FORK_CACHE): {
  readonly checkout: string;
  readonly prepare: string;
  readonly apply: string;
} {
  const checkout = join(cache, revision);
  return {
    checkout,
    prepare: `node scripts/prepare-typescript-fork.mjs --fetch --cache ${shellQuote(cache)}`,
    apply: `node compiler/forkpatch/forkpatch.mjs apply --checkout ${shellQuote(checkout)}`,
  };
}

function locateCheckout(revision: string): string {
  const configured = process.env.SMITHERS_TYPESCRIPT_FORK;
  if (configured !== undefined) {
    const checkout = resolve(configured);
    if (existsSync(checkout)) return checkout;
    const remedy = checkoutPreparationCommands(revision);
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_MISSING",
      `The pinned TypeScript fork checkout is absent at ${checkout}. ` +
      `Remedy: run \`${remedy.prepare}\`, then \`${remedy.apply}\`, then set ` +
      `SMITHERS_TYPESCRIPT_FORK=${shellQuote(remedy.checkout)}.`,
    );
  }

  const configuredCache = process.env.SMITHERS_TYPESCRIPT_FORK_CACHE;
  const caches = configuredCache === undefined
    ? [DEFAULT_FORK_CACHE, join(tmpdir(), "smithers-ts-fork-cache")]
    : [resolve(configuredCache)];
  for (const cache of caches) {
    const checkout = join(cache, revision);
    if (existsSync(checkout)) return checkout;
  }
  const remedy = checkoutPreparationCommands(revision, caches[0]);
  throw new GoBackendFailure(
    "SMITHERS_GO_CHECKOUT_MISSING",
    "The pinned TypeScript fork checkout is absent. " +
    `Remedy: run \`${remedy.prepare}\`, then \`${remedy.apply}\`, then set ` +
    `SMITHERS_TYPESCRIPT_FORK=${shellQuote(remedy.checkout)}.`,
  );
}

function verifyAppliedCheckout(checkout: string, revision: string): void {
  const forkpatch = join(repositoryRootOrThrow(), "compiler", "forkpatch", "forkpatch.mjs");
  if (!existsSync(forkpatch)) {
    throw new GoBackendFailure(
      "SMITHERS_GO_INSTALLATION",
      "The Go backend's forkpatch verifier is absent. Remedy: run `npm run build` from a complete Smithers source checkout.",
    );
  }
  const checked = spawnSync(process.execPath, [forkpatch, "status", "--checkout", checkout], {
    cwd: repositoryRootOrThrow(),
    encoding: "utf8",
    maxBuffer: GO_PROCESS_BUFFER,
  });
  if (checked.error) {
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_INVALID",
      `The pinned TypeScript fork checkout could not be verified: ${checked.error.message}. ` +
      `Remedy: run \`node compiler/forkpatch/forkpatch.mjs status --checkout ${shellQuote(checkout)}\`.`,
    );
  }
  if (checked.status !== 0) {
    const problem = detail(checked.stdout, checked.stderr);
    const code = /\bis [0-9a-f]{40}; require [0-9a-f]{40}\b/.test(problem)
      ? "SMITHERS_GO_CHECKOUT_REVISION"
      : "SMITHERS_GO_CHECKOUT_INVALID";
    const cleanCache = `${DEFAULT_FORK_CACHE}-clean`;
    const remedy = checkoutPreparationCommands(revision, cleanCache);
    throw new GoBackendFailure(
      code,
      `The pinned TypeScript fork checkout failed verification: ${problem}. ` +
      `Remedy: run \`${remedy.prepare}\`, then \`${remedy.apply}\`, then set ` +
      `SMITHERS_TYPESCRIPT_FORK=${shellQuote(remedy.checkout)}.`,
    );
  }

  let status: unknown;
  try {
    status = JSON.parse(checked.stdout);
  } catch {
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_INVALID",
      `The forkpatch verifier returned invalid JSON. Remedy: run ` +
      `\`node compiler/forkpatch/forkpatch.mjs status --checkout ${shellQuote(checkout)}\`.`,
    );
  }
  const record = status !== null && typeof status === "object"
    ? status as Record<string, unknown>
    : undefined;
  if (record?.revision !== revision) {
    const remedy = checkoutPreparationCommands(revision, `${DEFAULT_FORK_CACHE}-clean`);
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_REVISION",
      `The TypeScript fork checkout reports revision ${JSON.stringify(record?.revision)}; require ${revision}. ` +
      `Remedy: run \`${remedy.prepare}\`, then \`${remedy.apply}\`, then set ` +
      `SMITHERS_TYPESCRIPT_FORK=${shellQuote(remedy.checkout)}.`,
    );
  }
  if (record?.state === "pristine") {
    const command = `node compiler/forkpatch/forkpatch.mjs apply --checkout ${shellQuote(checkout)}`;
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_UNPATCHED",
      `The pinned TypeScript fork checkout is pristine but unpatched. Remedy: run \`${command}\`.`,
    );
  }
  if (record?.state !== "applied" || record.divergentFromApplied !== 0) {
    const remedy = checkoutPreparationCommands(revision, `${DEFAULT_FORK_CACHE}-clean`);
    throw new GoBackendFailure(
      "SMITHERS_GO_CHECKOUT_DIVERGENT",
      `The pinned TypeScript fork checkout is partially patched or divergent (state ${JSON.stringify(record?.state)}, ` +
      `divergentFromApplied ${JSON.stringify(record?.divergentFromApplied)}). Do not patch over this checkout. ` +
      `Remedy: run \`${remedy.prepare}\`, then \`${remedy.apply}\`, then set ` +
      `SMITHERS_TYPESCRIPT_FORK=${shellQuote(remedy.checkout)}.`,
    );
  }
}

function assertCompileResult(value: unknown): asserts value is GoBackendCompileResult {
  if (value === null || typeof value !== "object") {
    throw new TypeError("result is not an object");
  }
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.diagnostics) || !Array.isArray(result.artifacts) ||
    typeof result.emitSkipped !== "boolean") {
    throw new TypeError("result is missing diagnostics, artifacts, or emitSkipped");
  }
  for (const item of result.diagnostics) {
    if (item === null || typeof item !== "object" ||
      typeof (item as Record<string, unknown>).code !== "string" ||
      typeof (item as Record<string, unknown>).category !== "string" ||
      typeof (item as Record<string, unknown>).message !== "string") {
      throw new TypeError("result contains an invalid diagnostic");
    }
  }
  for (const item of result.artifacts) {
    if (item === null || typeof item !== "object" ||
      typeof (item as Record<string, unknown>).path !== "string" ||
      typeof (item as Record<string, unknown>).content !== "string") {
      throw new TypeError("result contains an invalid artifact");
    }
  }
}

/**
 * Drive cmd/smithersc-go exactly as the conformance backend does: build the thin
 * command, submit one --request value, and let it prepare/handshake with the
 * pinned fork bridge. No JS compiler is reachable from this path.
 */
export function invokeGoBackend(request: GoBackendRequest): GoBackendCompileResult {
  const revision = pinnedRevision();
  const checkout = locateCheckout(revision);
  verifyAppliedCheckout(checkout, revision);

  const workspace = mkdtempSync(join(tmpdir(), "smithers-cli-go-"));
  try {
    const binary = join(workspace, process.platform === "win32" ? "smithersc-go.exe" : "smithersc-go");
    const goCommand = process.env.SMITHERS_GO ?? "go";
    const built = spawnSync(goCommand, ["build", "-o", binary, "./cmd/smithersc-go"], {
      cwd: repositoryRootOrThrow(),
      encoding: "utf8",
      maxBuffer: GO_PROCESS_BUFFER,
      timeout: 300_000,
    });
    if (built.error || built.status !== 0) {
      const problem = built.error?.message ?? detail(built.stdout, built.stderr);
      throw new GoBackendFailure(
        "SMITHERS_GO_BUILD",
        `The Go backend command could not be built: ${problem}. Remedy: run \`go build ./cmd/smithersc-go\`.`,
      );
    }

    const requestPath = join(workspace, "request.json");
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", flag: "wx" });
    const args = [
      "--fork-checkout", checkout,
      "--timeout", "5m",
      ...(process.env.SMITHERS_GO_FORK_CACHE
        ? ["--fork-cache", resolve(process.env.SMITHERS_GO_FORK_CACHE)]
        : []),
      ...(process.env.SMITHERS_GO ? ["--go-command", process.env.SMITHERS_GO] : []),
      "--request", requestPath,
    ];
    const invoked = spawnSync(binary, args, {
      cwd: repositoryRootOrThrow(),
      encoding: "utf8",
      maxBuffer: GO_PROCESS_BUFFER,
      timeout: 330_000,
    });
    if (invoked.error) {
      throw new GoBackendFailure(
        "SMITHERS_GO_BACKEND",
        `The Go compiler process could not run: ${invoked.error.message}. Remedy: run ` +
        `\`SMITHERS_TYPESCRIPT_FORK=${shellQuote(checkout)} go test ./compiler ./cmd/smithersc-go -count=1\`.`,
      );
    }
    if (invoked.status === 64 || invoked.stdout.trim() === "") {
      throw new GoBackendFailure(
        "SMITHERS_GO_PROTOCOL",
        `smithersc-go rejected the compiler request (exit ${invoked.status}): ${detail(invoked.stdout, invoked.stderr)}. ` +
        "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
      );
    }

    let result: unknown;
    try {
      result = JSON.parse(invoked.stdout);
      assertCompileResult(result);
    } catch (error) {
      throw new GoBackendFailure(
        "SMITHERS_GO_PROTOCOL",
        `smithersc-go did not return one valid CompileResult: ${error instanceof Error ? error.message : String(error)}. ` +
        "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
      );
    }
    const infrastructure = result.diagnostics.find((item) =>
      item.code === "SMITHERS_GO_BACKEND" || item.code === "SMITHERS_GO_TIMEOUT");
    if (infrastructure) {
      const code = infrastructure.code === "SMITHERS_GO_TIMEOUT" ? "SMITHERS_GO_TIMEOUT" : "SMITHERS_GO_BUILD";
      throw new GoBackendFailure(
        code,
        `${infrastructure.message}. Remedy: run ` +
        `\`SMITHERS_TYPESCRIPT_FORK=${shellQuote(checkout)} go test ./compiler ./cmd/smithersc-go -count=1\`.`,
      );
    }
    if (invoked.status !== 0 && invoked.status !== 1) {
      throw new GoBackendFailure(
        "SMITHERS_GO_PROTOCOL",
        `smithersc-go exited ${invoked.status}: ${detail(invoked.stdout, invoked.stderr)}. ` +
        "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
      );
    }
    return result;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
