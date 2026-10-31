// The ts-bump flow's eval: it runs the flow, unmocked, on a fresh jj workspace
// of this repository and moves the fork to two real typescript@next nightlies
// after the pin (7.1.0-dev.20261015.1, upstream 257e874), then scores what
// it did against facts measured once by hand on 2026-10-31:
//
// - 7.1.0-dev.20261022.1 (98add1b): one week of upstream. The three-way merge
//   has no conflict, but the build fails in VibeLang's own glue:
//   internal/effecttsgo/lint/command.go passes a vfs.FS where
//   tsoptions.GetParsedCommandLineOfConfigFilePath now takes a ParseConfigHost.
// - 7.1.0-dev.20261031.1 (6161772): two weeks. tsc/internal/compiler/emitter.go
//   and tsc/internal/ls/utilities.go conflict with the fork's seams.
//
// Scorers: preserved, an oracle independent of diff3: in each file both sides
// changed, every line the fork added and every line upstream added is in the
// result; pinned, VIBELANG.md names the target; conflicts, the report names
// the known conflicting files and no others; found, the report names the known
// compile errors.
//
//   bun .smithers/flows/ts-bump/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/ts-bump/eval.ts --update   run and record baseline.json
//
// TS_BUMP_KEEP=1 keeps the workspaces and run directories. When the pin moves
// past a case's target, move the cases to the nightlies after the new pin and
// measure their facts again (README.md).
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinned } from "./lib/steps.mjs";
import { execute } from "./run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "../../..");
const baselineFile = join(here, "baseline.json");
const target = { name: "ts-bump" };

type Input = { readonly to: string; readonly targets: string; readonly conflicts: ReadonlyArray<string>; readonly found: ReadonlyArray<string> };
type Output = {
  readonly pinned: boolean;
  readonly conflicts: ReadonlyArray<string>;
  readonly failing: ReadonlyArray<string>;
  readonly preserved: { readonly files: number; readonly lost: ReadonlyArray<string> };
  readonly error?: string;
};

const cases = [
  {
    name: "upstream-20261022",
    input: {
      to: "98add1bbed1c814e97457587c2da407dc3f78330",
      targets: "//typescript:compiler //:spec-tests",
      conflicts: [],
      found: ["internal/effecttsgo/lint/command.go"]
    } satisfies Input
  },
  {
    name: "upstream-20261031",
    input: {
      to: "6161772c1370bdd4a82f808e6823bd755eb1870d",
      targets: "//typescript:compiler",
      conflicts: ["tsc/internal/compiler/emitter.go", "tsc/internal/ls/utilities.go"],
      found: []
    } satisfies Input
  }
];

const score = (id: string, f: (input: Input, output: Output) => number) =>
  Scorer.make({ id: `ts-bump/${id}`, version: "1", name: id, score: ({ input, output }) => Effect.succeed({ score: f(input as Input, output as Output) }) });

const preserved = score("preserved", (_, o) => o.preserved.files === 0 ? 0 : 1 - o.preserved.lost.length / o.preserved.files);
const pin = score("pinned", (_, o) => o.pinned ? 1 : 0);
const conflicts = score("conflicts", (i, o) =>
  i.conflicts.length === 0 ? (o.conflicts.length === 0 ? 1 : 0) : i.conflicts.filter((c) => o.conflicts.includes(c)).length / i.conflicts.length);
const found = score("found", (i, o) =>
  i.found.length === 0 ? 1 : i.found.filter((f) => o.failing.some((x) => x.includes(f))).length / i.found.length);

const lineSet = (file: string) => new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n") : []);

// lost lists the merged files missing a line the fork or upstream added.
function lost(run: string, from: string, to: string, ours: string, merged: ReadonlyArray<{ file: string }>, before: (p: string) => string) {
  const out: Array<string> = [];
  for (const { file } of merged) {
    const base = lineSet(join(run, "upstream", from, file));
    const result = lineSet(join(ours, file));
    const added = (text: Set<string>) => [...text].filter((l) => !base.has(l));
    const missing = [...added(lineSet(before(file))), ...added(lineSet(join(run, "upstream", to, file)))].filter((l) => !result.has(l));
    if (missing.length) out.push(`${file}: ${JSON.stringify(missing[0])}`);
  }
  return out;
}

function bumpFresh(input: Input): Promise<Output> {
  const name = `ts-bump-eval-${process.pid}-${input.to.slice(0, 8)}`;
  const scratch = mkdtempSync(join(tmpdir(), "ts-bump-eval-"));
  const workspace = join(scratch, "repo"), run = join(scratch, "run");
  const jj = (...args: Array<string>) => execFileSync("jj", args, { cwd: repository, stdio: "pipe" });
  // One commit for the whole run, so a rewrite of @ meanwhile cannot move the
  // fork the preserved oracle compares with or leave the workspace stale.
  const start = execFileSync("jj", ["log", "--no-graph", "--ignore-working-copy", "-r", "@", "-T", "commit_id"], { cwd: repository, encoding: "utf8" }).trim();
  jj("workspace", "add", workspace, "--name", name, "-r", start);
  const cleanup = () => {
    if (process.env.TS_BUMP_KEEP) return console.log(`ts-bump eval: kept ${scratch}`);
    try { jj("abandon", `${name}@`); jj("workspace", "forget", name); } catch {}
    rmSync(scratch, { recursive: true, force: true });
  };
  // The fork's files before the merge, for the preserved oracle.
  const before = (p: string) => {
    const copy = join(scratch, "before", p);
    try {
      execFileSync("mkdir", ["-p", dirname(copy)]);
      writeFileSync(copy, execFileSync("jj", ["file", "show", "--ignore-working-copy", "-r", start, `typescript/${p}`], { cwd: repository, maxBuffer: 64 << 20 }));
    } catch {}
    return copy;
  };
  return execute({ run, repo: workspace, to: input.to, targets: input.targets }).then((exit) => {
    const read = (step: string) => existsSync(join(run, `${step}.json`)) ? JSON.parse(readFileSync(join(run, `${step}.json`), "utf8")) : undefined;
    const fetch = read("fetch"), merge = read("merge");
    const merged = [...(merge?.merged ?? [])];
    const output: Output = {
      pinned: pinned(workspace) === input.to,
      conflicts: (merge?.conflicts ?? []).map((c: { file: string }) => c.file),
      failing: read("report")?.failing ?? [],
      preserved: { files: merged.length, lost: fetch && merge ? lost(run, fetch.from, fetch.to, join(workspace, "typescript"), merged, before) : ["no merge"] },
      ...(Exit.isFailure(exit) ? { error: String(exit.cause) } : {})
    };
    cleanup();
    return output;
  }, (error) => { cleanup(); throw error; });
}

// A flow that stops before its report is a failed case, never a score: the
// runner records it as an error, and --update refuses to record a baseline.
const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const output = await bumpFresh(suiteCase.input as Input);
    console.log(`ts-bump eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    if (output.error !== undefined) throw new Error(output.error);
    return { output, stepKey: suiteCase.name, latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "ts-bump",
    cases,
    bindings: [preserved, pin, conflicts, found].map((scorer) => Binding.make({ scorer, appliesTo: target })),
    concurrency: 1
  });
  const run = yield* Runner.run(suite, { runId: `ts-bump-${Date.now()}`, at: new Date().toISOString() });
  if (process.argv.includes("--update")) {
    if (run.cases.some((result) => result.error !== undefined)) return yield* Effect.die("a case did not finish; no baseline recorded");
    writeFileSync(baselineFile, Baseline.write(yield* Baseline.fromRun(run)));
    console.log("ts-bump eval: baseline recorded");
    return 0;
  }
  const comparison = yield* Regression.compare(yield* Baseline.load(readFileSync(baselineFile, "utf8")), run);
  console.log(Report.markdown(comparison));
  const { exitCode, summary } = Gate.ciGrade(yield* Gate.check(comparison, { mean: 1 }));
  console.log(summary);
  return exitCode;
}).pipe(Effect.provide(Layer.succeed(CaseExecutor.CaseExecutor)(executor)));

process.exitCode = await Effect.runPromise(program);
