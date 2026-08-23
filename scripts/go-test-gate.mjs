#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { locateForkCheckout, repositoryRoot } from "./fork-e2e.mjs";

const goPackages = ["./compiler", "./cmd/smithersc-go"];

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function preparationRemedy({ ignoreConfiguredFork = false } = {}) {
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, "typescript-fork.json"), "utf8"),
  );
  const requestedFork = process.env.SMITHERS_TYPESCRIPT_FORK;
  const configuredFork = ignoreConfiguredFork ? undefined : requestedFork;
  if (configuredFork && basename(resolve(configuredFork)) === manifest.revision) {
    return `node scripts/prepare-typescript-fork.mjs --fetch --cache ${shellQuote(dirname(resolve(configuredFork)))}`;
  }

  const cache = process.env.SMITHERS_TYPESCRIPT_FORK_CACHE
    ? resolve(process.env.SMITHERS_TYPESCRIPT_FORK_CACHE)
    : join(tmpdir(), "smithers-ts-fork-cache");
  const prepare = `node scripts/prepare-typescript-fork.mjs --fetch --cache ${shellQuote(cache)}`;
  return requestedFork ? `unset SMITHERS_TYPESCRIPT_FORK; ${prepare}` : prepare;
}

function testKey(event) {
  return `${event.Package}\0${event.Test}`;
}

function skipReason(outputs) {
  const candidates = outputs
    .flatMap((output) => output.split("\n"))
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !line.startsWith("=== RUN") &&
        !line.startsWith("=== PAUSE") &&
        !line.startsWith("=== CONT") &&
        !line.startsWith("--- SKIP:"),
    );
  const reported = candidates.at(-1);
  if (!reported) return "reason not reported";
  return reported.replace(/^\S+_test\.go:\d+:\s*/u, "").replaceAll(/\s+/gu, " ");
}

function censusLine(results, outputByTest) {
  const passed = results.filter((result) => result.action === "pass").length;
  const failed = results.filter((result) => result.action === "fail").length;
  const skipped = results
    .filter((result) => result.action === "skip")
    .map((result) => ({
      ...result,
      reason: skipReason(outputByTest.get(result.key) ?? []),
    }))
    .sort((left, right) => {
      const leftKey = `${left.package}/${left.test}`;
      const rightKey = `${right.package}/${right.test}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const skipReport =
    skipped.length === 0
      ? "none"
      : skipped
          .map(({ package: packageName, test, reason }) => `${packageName}:${test}: ${reason}`)
          .join("; ");
  return {
    failed,
    line: `Go test census: ran ${passed + failed} (passed ${passed}, failed ${failed}), skipped ${skipped.length}; skip reasons: ${skipReport}`,
    skipped,
  };
}

async function main() {
  const checkout = await locateForkCheckout();
  if (!checkout) {
    process.stderr.write(
      `Go fork test preflight failed: no pinned TypeScript fork checkout could be resolved.\nRemedy: ${await preparationRemedy()}\n`,
    );
    return 1;
  }
  if (!existsSync(join(checkout, "go.work"))) {
    process.stderr.write(
      `Go fork test preflight failed: resolved checkout ${checkout} has no go.work.\nRemedy: ${await preparationRemedy({ ignoreConfiguredFork: true })}\n`,
    );
    return 1;
  }

  process.stdout.write(`Go fork test preflight: SMITHERS_TYPESCRIPT_FORK=${checkout}\n`);
  const child = spawn("go", ["test", "-count=1", "-json", ...goPackages], {
    cwd: repositoryRoot,
    env: { ...process.env, SMITHERS_TYPESCRIPT_FORK: checkout },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const completion = new Promise((resolveCompletion) => {
    child.once("error", (error) => resolveCompletion({ code: undefined, error }));
    child.once("close", (code, signal) => resolveCompletion({ code, signal }));
  });

  const outputByTest = new Map();
  const results = [];
  let malformedOutput = false;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformedOutput = true;
      process.stdout.write(`${line}\n`);
      continue;
    }
    if (event.Action === "output") {
      process.stdout.write(event.Output);
      if (event.Test) {
        const key = testKey(event);
        const outputs = outputByTest.get(key) ?? [];
        outputs.push(event.Output);
        outputByTest.set(key, outputs);
      }
    }
    if (event.Test && ["pass", "fail", "skip"].includes(event.Action)) {
      results.push({
        action: event.Action,
        key: testKey(event),
        package: event.Package,
        test: event.Test,
      });
    }
  }

  const completed = await completion;
  const census = censusLine(results, outputByTest);
  process.stdout.write(`${census.line}\n`);

  if (completed.error) {
    process.stderr.write(`Go fork test gate failed to start: ${completed.error.message}\n`);
    return 1;
  }
  if (completed.signal) {
    process.stderr.write(`Go fork test gate ended from signal ${completed.signal}.\n`);
    return 1;
  }
  if (malformedOutput) {
    process.stderr.write("Go fork test gate received output that was not valid go test JSON.\n");
    return 1;
  }
  if (results.length === 0) {
    process.stderr.write("Go fork test gate failed: no Go tests ran.\n");
    return 1;
  }
  const checkoutSkips = census.skipped.filter(({ reason }) =>
    /SMITHERS_TYPESCRIPT_FORK|pinned checkout|executable fork|executable CLI/iu.test(reason),
  );
  if (checkoutSkips.length > 0) {
    process.stderr.write("Go fork test gate failed: checkout-backed tests were skipped.\n");
    return 1;
  }
  if (completed.code !== 0 || census.failed > 0) return completed.code || 1;
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(
      `Go fork test gate failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
