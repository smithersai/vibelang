import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    timeout: 300_000, killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`Native compiler preparation failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** Build-time only. The copied executable requires neither Go nor a checkout. */
export function buildNativeCompiler() {
  const pin = JSON.parse(readFileSync(join(root, "typescript-fork.json"), "utf8"));
  let checkout = process.env.VIBELANG_TYPESCRIPT_FORK;
  if (checkout === undefined) {
    const cache = process.env.VIBELANG_TYPESCRIPT_FORK_CACHE ?? join(tmpdir(), "vibelang-ts-fork-cache");
    checkout = join(cache, pin.revision);
    if (!existsSync(checkout)) {
      // The vendored capsule is the offline default; never implicitly fetch.
      run(process.execPath, ["scripts/prepare-typescript-fork.mjs", "--cache", cache]);
    }
  }
  const go = process.env.VIBELANG_GO ?? "go";
  const args = ["run", "./cmd/vibec-prepare", "--fork-checkout", resolve(checkout)];
  if (process.env.VIBELANG_GO) args.push("--go-command", go);
  const prepared = JSON.parse(run(go, args));
  const goOS = process.platform === "win32" ? "windows" : process.platform;
  const goArch = process.arch === "x64" ? "amd64" : process.arch;
  if (prepared.revision !== pin.revision || prepared.os !== goOS || prepared.arch !== goArch ||
    !Number.isSafeInteger(prepared.apiVersion) || typeof prepared.executable !== "string" ||
    !/^[a-f0-9]{64}$/.test(prepared.sha256)) throw new Error("Native preparation returned incompatible metadata");
  const directory = join(root, "poc/dist/compiler/native", `${process.platform}-${process.arch}`);
  const executable = process.platform === "win32" ? "vibelang-native.exe" : "vibelang-native";
  mkdirSync(directory, { recursive: true });
  copyFileSync(prepared.executable, join(directory, executable));
  chmodSync(join(directory, executable), 0o755);
  if (createHash("sha256").update(readFileSync(join(directory, executable))).digest("hex") !== prepared.sha256) {
    throw new Error("Native executable changed between preparation and packaging");
  }
  // No build/cache paths enter a distributable identity or reproducibility hash.
  const manifest = {
    apiVersion: prepared.apiVersion, revision: prepared.revision, patchSeries: prepared.patchSeries,
    compilerVersion: prepared.compilerVersion, sha256: prepared.sha256,
    platform: process.platform, arch: process.arch, executable,
  };
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
