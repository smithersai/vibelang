// The migrate flow's eval: it runs the flow, unmocked and with no agent, on a
// real Effect package and scores the migration. The fixture,
// fixture/canonical, is @smthrs/canonical 1.0.0-rc.16: its src/ as published
// to npm, nine of its test files from the Smithers repository, and a manifest
// that keeps the package's pins (Effect 4.0.5, older than the runtime's).
// fixture/README.md says what else changed. The flow's one-pass plan
// (--scope) migrates every module of src/ in one batch:
// upgrade-effect, setup, plan, codemod (rename and --fix), compile, repair
// (settle), verify, record and report.
//
// Scorers: migrated, the share of the scope's modules that end the run as
// .vibe; checks, the share of verify's checks that pass; tests, verify found no
// new failing or missing test; declarations, verify found the published
// declarations unchanged; recorded, record committed the batch.
//
//   bun .smithers/flows/migrate/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/migrate/eval.ts --update   run and record baseline.json
//
// It stages the toolchain from this checkout, so build it first:
// sh scripts/build-vibelang.sh, then bun install && bun run build in
// packages/runtime. A run installs the fixture's dependencies with pnpm from
// the registry. MIGRATE_EVAL_KEEP=1 keeps the target, the toolchain and the
// run directory.
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import migrate from "./flow.ts";
import * as Jj from "./lib/jj.mjs";
import { stageToolchain } from "./lib/toolchain.mjs";
import { must } from "./lib/util.mjs";
import { runtime } from "./run.ts";
import { stepKey } from "../step-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "../../..");
const baselineFile = join(here, "baseline.json");
const target = { name: "migrate" };

type Input = { readonly fixture: string; readonly test: string };
type Output = {
  readonly scope: number;
  readonly migrated: number;
  readonly checks: { readonly passed: ReadonlyArray<string>; readonly failed: ReadonlyArray<string> };
  readonly testsPass: boolean;
  readonly declarationsSame: boolean;
  readonly commit: string | null;
  readonly error?: string;
};

const cases = [{ name: "smthrs-canonical", input: { fixture: "canonical", test: "pnpm test" } satisfies Input }];

const score = (id: string, f: (output: Output) => number) =>
  Scorer.make({ id: `migrate/${id}`, version: "1", name: id, score: ({ output }) => Effect.succeed({ score: f(output as Output) }) });

const migrated = score("migrated", (o) => (o.scope === 0 ? 0 : o.migrated / o.scope));
const checks = score("checks", (o) => {
  const total = o.checks.passed.length + o.checks.failed.length;
  return total === 0 ? 0 : o.checks.passed.length / total;
});
const tests = score("tests", (o) => (o.testsPass ? 1 : 0));
const declarations = score("declarations", (o) => (o.declarationsSame ? 1 : 0));
const recorded = score("recorded", (o) => (o.commit ? 1 : 0));

const readIf = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);

// The compiler is part of the work a case grades, so its digest is part of the step key.
const compilerDigest = (toolchain: string) =>
  createHash("sha256").update(readFileSync(join(toolchain, "native/vibelang"))).digest("hex").slice(0, 12);

async function migrateFresh(input: Input): Promise<Output & { readonly compiler: string }> {
  const scratch = mkdtempSync(join(tmpdir(), "migrate-eval-"));
  const repo = join(scratch, "repo"), run = join(scratch, "run"), toolchain = join(scratch, "toolchain");
  try {
    await stageToolchain({ vibelang: repository, out: toolchain });
    cpSync(join(here, "fixture", input.fixture), repo, { recursive: true, filter: (src) => !src.includes("/node_modules") });
    await must("jj git init && jj config set --repo user.name migrate-eval && jj config set --repo user.email migrate-eval@localhost", { cwd: repo });
    await Jj.commit(repo, `${input.fixture}: the fixture as vendored`);
    await Jj.setBookmark(repo, "main", "@-");
    // A clone knows its default branch from its remote; this repository has none, so name it.
    await must(`jj config set --repo 'revset-aliases."trunk()"' main`, { cwd: repo });
    const scope = (readdirSync(join(repo, "src"), { recursive: true }) as Array<string>)
      .filter((f) => f.endsWith(".ts")).sort().map((f) => `src/${f}`);
    const scopeFile = join(scratch, "scope.txt");
    writeFileSync(scopeFile, scope.join("\n") + "\n");
    const exit = await Effect.runPromiseExit(
      migrate.execute(
        { run, target: repo, packages: ["."], test: input.test, testCwd: ".", toolchain, scope: scopeFile },
        { executionId: `migrate-eval-${Date.now()}` }
      ).pipe(Effect.provide(runtime))
    );
    const verify = readIf(join(run, "batches/01/verify.json"));
    const record = readIf(join(run, "batches/01/record.json"));
    return {
      scope: scope.length,
      migrated: scope.filter((f) => existsSync(join(repo, f.replace(/\.ts$/, ".vibe")))).length,
      checks: {
        passed: Object.keys(verify?.checks ?? {}).filter((name) => verify.checks[name] === true),
        failed: Object.keys(verify?.checks ?? {}).filter((name) => verify.checks[name] !== true)
      },
      testsPass: verify?.checks?.tests === true,
      declarationsSame: verify?.checks?.declarations === true,
      commit: record?.commit ?? null,
      compiler: compilerDigest(toolchain),
      ...(Exit.isFailure(exit) && verify === undefined ? { error: String(exit.cause) } : {})
    };
  } finally {
    if (process.env.MIGRATE_EVAL_KEEP) console.log(`migrate eval: kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
}

// A flow that stops before verify is a failed case, never a score: the runner
// records it as an error, and --update refuses to record a baseline. A verify
// that fails is a result: record refuses the batch and the scores say why.
const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const { compiler, ...output } = await migrateFresh(suiteCase.input as Input);
    console.log(`migrate eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    if (output.error !== undefined) throw new Error(output.error);
    return { output, stepKey: stepKey(suiteCase.name, here) + "+" + compiler, latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "migrate",
    cases,
    bindings: [migrated, checks, tests, declarations, recorded].map((scorer) => Binding.make({ scorer, appliesTo: target })),
    concurrency: 1
  });
  const run = yield* Runner.run(suite, { runId: `migrate-${Date.now()}`, at: new Date().toISOString() });
  if (process.argv.includes("--update")) {
    if (run.cases.some((result) => result.error !== undefined)) return yield* Effect.die("a case did not finish; no baseline recorded");
    writeFileSync(baselineFile, Baseline.write(yield* Baseline.fromRun(run)));
    console.log("migrate eval: baseline recorded");
    return 0;
  }
  const comparison = yield* Regression.compare(yield* Baseline.load(readFileSync(baselineFile, "utf8")), run);
  console.log(Report.markdown(comparison));
  const { exitCode, summary } = Gate.ciGrade(yield* Gate.check(comparison));
  console.log(summary);
  return exitCode;
}).pipe(Effect.provide(Layer.succeed(CaseExecutor.CaseExecutor)(executor)));

process.exitCode = await Effect.runPromise(program);
