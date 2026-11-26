import { Action, Flow } from "@smthrs/flow";
import { ScanFixVerify } from "@smthrs/patterns";
import { Node } from "@smthrs/plan";
import { NodeChildProcessSpawner } from "@smthrs/platform-node/NodeHost";
import { CommandSandbox } from "@smthrs/sandbox";
import { Effect, Layer, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  classifyCampaignResult,
  collectLocalCrashers,
  fileFinding,
  verifyCrashers,
  writeReport
} from "./lib/steps.mjs";

// Durable fuzz-campaign flow built on ScanFixVerify (@smthrs/patterns) and
// CommandSandbox (@smthrs/sandbox) (#471):
// 1. Prepare: acquire a sandbox session on `machine` ([] = local, or ssh argv
//    prefix), sync/prepare the checkout on the machine.
// 2. ScanFixVerify:
//    - scan: run campaign.sh once in the sandbox, pull every crasher and target
//      log back through session.readFile, fail with log excerpt if campaign
//      broke before fuzzing, and emit any unrecorded crashers as issues.
//    - fix: file one finding per failure key or record a duplicate.
//    - verify: assert every crasher has an on-disk finding or duplicate record.
// 3. Report: write report.json and fail if any crasher remains unresolved.
//
// Note: switching `machine` to a declared S.Remotes target waits on a published
// @smthrs/* release containing smithersai/smithers@c72e767d3179 (#4570).

const implementationVersion = "fuzz-campaign/v1";

const Outcome = Schema.Struct({
  step: Schema.String,
  ok: Schema.Boolean,
  resolved: Schema.Boolean,
  filed: Schema.Number,
  duplicates: Schema.Number,
  summary: Schema.String
});

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
  step: Schema.String,
  message: Schema.String
}) {}

const StartPayload = {
  run: Schema.String,
  repo: Schema.String,
  findings: Schema.String,
  machine: Schema.optional(Schema.Array(Schema.String)),
  workdir: Schema.optional(Schema.String),
  duration: Schema.optional(Schema.String),
  targets: Schema.optional(Schema.Array(Schema.String)),
  prepareCmd: Schema.optional(Schema.String),
  campaignCmd: Schema.optional(Schema.String)
};

const StartSchema = Schema.Struct(StartPayload);
type StartInput = Schema.Schema.Type<typeof StartSchema>;

export const Prepare = Action.make("fuzz-campaign/Prepare", {
  implementationVersion,
  payload: StartPayload,
  success: Outcome,
  error: StepFailed
});

export const Scan = Action.make("fuzz-campaign/Scan", {
  implementationVersion,
  payload: { input: StartSchema, iteration: Schema.Number },
  success: Schema.Array(Schema.Unknown),
  error: StepFailed
});

export const Fix = Action.make("fuzz-campaign/Fix", {
  implementationVersion,
  payload: { issue: Schema.Unknown, index: Schema.Number, iteration: Schema.Number },
  success: Schema.Unknown,
  error: StepFailed
});

export const Verify = Action.make("fuzz-campaign/Verify", {
  implementationVersion,
  payload: {
    input: StartSchema,
    issues: Schema.Array(Schema.Unknown),
    fixes: Schema.Array(Schema.Unknown),
    iteration: Schema.Number
  },
  success: Schema.Unknown,
  error: StepFailed
});

export const Report = Action.make("fuzz-campaign/Report", {
  implementationVersion,
  payload: { input: StartSchema, report: Schema.Unknown },
  success: Outcome,
  error: StepFailed
});

const decoder = new TextDecoder();

const collectStream = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => {
      const parts = Array.from(chunks);
      const total = parts.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of parts) {
        out.set(c, offset);
        offset += c.length;
      }
      return decoder.decode(out);
    })
  );

const execInSession = (session: { readonly spawn: any; readonly workdir: string }, command: string, env?: Record<string, string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const proc = yield* session.spawn(command, { cwd: session.workdir, env });
      const [stdout, stderr, exitCode] = yield* Effect.all([
        collectStream(proc.stdout),
        collectStream(proc.stderr),
        proc.exitCode
      ], { concurrency: "unbounded" });
      return { stdout, stderr, exitCode };
    })
  );

const withSandbox = <A>(
  input: StartInput,
  stepName: string,
  fn: (session: {
    readonly workdir: string;
    readonly spawn: any;
    readonly readFile: (p: string) => Effect.Effect<Uint8Array, any>;
  }) => Effect.Effect<A, unknown>
): Effect.Effect<A, StepFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;
      const workdir = input.workdir ?? path.join(input.run, "sandbox");
      const provider = CommandSandbox.make({
        spawner,
        prefix: input.machine ?? [],
        workdir,
        name: (input.machine && input.machine.length > 0) ? input.machine[0] : "local"
      });
      const session = yield* provider.acquire(`fuzz-campaign-${path.basename(input.run)}`);
      return yield* fn(session);
    })
  ).pipe(
    Effect.provide(NodeChildProcessSpawner.layer),
    Effect.mapError((error) =>
      error instanceof StepFailed
        ? error
        : new StepFailed({ step: stepName, message: error instanceof Error ? error.message : String(error) })
    )
  );

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const crashersPath = (runDir: string) => path.join(runDir, "crashers.json");

const runPrepare = (input: StartInput) =>
  withSandbox(input, "prepare", (session) =>
    Effect.gen(function* () {
      mkdirSync(input.run, { recursive: true });
      const cmd = input.prepareCmd ??
        `mkdir -p ${shellQuote(session.workdir)} && cp -R ${shellQuote(input.repo)}/. ${shellQuote(session.workdir)}/`;
      const res = yield* execInSession(session, cmd);
      if (res.exitCode !== 0) {
        return yield* Effect.fail(
          new StepFailed({
            step: "prepare",
            message: `prepare exited ${res.exitCode}: ${(res.stderr || res.stdout).trim().slice(-500)}`
          })
        );
      }
      return {
        step: "prepare",
        ok: true,
        resolved: true,
        filed: 0,
        duplicates: 0,
        summary: `prepared sandbox at ${session.workdir}`
      };
    })
  );

const runScan = ({ input, iteration }: { readonly input: StartInput; readonly iteration: number }) => {
  if (iteration > 1) {
    return Effect.try({
      try: () => {
        const saved = existsSync(crashersPath(input.run))
          ? JSON.parse(readFileSync(crashersPath(input.run), "utf8"))
          : [];
        const verified = verifyCrashers(input.findings, saved);
        return verified.missing.map((crasher: any) => ({ ...crasher, findings: input.findings }));
      },
      catch: (error) => new StepFailed({ step: "scan", message: error instanceof Error ? error.message : String(error) })
    });
  }

  return withSandbox(input, "scan", (session) =>
    Effect.gen(function* () {
      const remoteOut = path.posix.join(session.workdir, ".campaign-out");
      const localCrashersDir = path.join(input.run, "crashers");
      const localLogsDir = path.join(input.run, "logs");
      mkdirSync(localCrashersDir, { recursive: true });
      mkdirSync(localLogsDir, { recursive: true });

      const duration = input.duration ?? "1m";
      const targets = (input.targets ?? []).map(shellQuote).join(" ");
      const defaultCmd = `sh typescript/tsc/internal/vibelangfuzz/campaign.sh ${shellQuote(duration)}${targets ? " " + targets : ""}`;
      const campaignCmd = input.campaignCmd ?? defaultCmd;

      const res = yield* execInSession(
        session,
        `mkdir -p ${shellQuote(remoteOut)} && CAMPAIGN_OUT=${shellQuote(remoteOut)} ${campaignCmd}`
      );
      const combinedLog = `${res.stdout}${res.stderr}`;
      writeFileSync(path.join(localLogsDir, "campaign.log"), combinedLog, "utf8");

      const summaryText = yield* session.readFile(path.posix.join(remoteOut, "summary.txt")).pipe(
        Effect.map((bytes) => decoder.decode(bytes)),
        Effect.catch(() => Effect.succeed(""))
      );
      if (summaryText) writeFileSync(path.join(localLogsDir, "summary.txt"), summaryText, "utf8");

      const listCrashers = yield* execInSession(
        session,
        `if [ -d ${shellQuote(remoteOut)}/crashers ]; then find ${shellQuote(remoteOut)}/crashers -type f | sort; fi`
      );
      const remoteCrasherFiles = listCrashers.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const targetsSeen = new Set<string>();
      for (const remoteFile of remoteCrasherFiles) {
        const rel = path.posix.relative(path.posix.join(remoteOut, "crashers"), remoteFile);
        const target = rel.split("/")[0];
        if (target) targetsSeen.add(target);
        const bytes = yield* session.readFile(remoteFile);
        const dest = path.join(localCrashersDir, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, bytes);
      }
      for (const target of targetsSeen) {
        const targetLog = yield* session.readFile(path.posix.join(remoteOut, `${target}.log`)).pipe(
          Effect.map((bytes) => decoder.decode(bytes)),
          Effect.catch(() => Effect.succeed(""))
        );
        if (targetLog) writeFileSync(path.join(localLogsDir, `${target}.log`), targetLog, "utf8");
      }

      const collectedCrashers = collectLocalCrashers(localCrashersDir, localLogsDir);
      writeFileSync(crashersPath(input.run), JSON.stringify(collectedCrashers, null, 2) + "\n", "utf8");
      const classified = classifyCampaignResult({
        exitCode: res.exitCode,
        summaryText,
        logText: combinedLog,
        crashers: collectedCrashers
      });
      return classified.crashers.map((crasher: any) => ({ ...crasher, findings: input.findings }));
    })
  );
};

const runFix = ({ issue }: { readonly issue: unknown }) =>
  Effect.try({
    try: () => {
      const crasher = issue as { readonly findings: string };
      return fileFinding(crasher.findings, crasher);
    },
    catch: (error) => new StepFailed({ step: "fix", message: error instanceof Error ? error.message : String(error) })
  });

const runVerify = ({
  input,
  issues,
  fixes
}: {
  readonly input: StartInput;
  readonly issues: ReadonlyArray<unknown>;
  readonly fixes: ReadonlyArray<unknown>;
}) =>
  Effect.try({
    try: () => ({ ...verifyCrashers(input.findings, issues), fixes }),
    catch: (error) => new StepFailed({ step: "verify", message: error instanceof Error ? error.message : String(error) })
  });

const runReport = ({ input, report }: { readonly input: StartInput; readonly report: unknown }) =>
  Effect.gen(function* () {
    const result = report as {
      readonly resolved: boolean;
      readonly iterations: number;
      readonly remaining: ReadonlyArray<unknown>;
      readonly verifications: ReadonlyArray<{ readonly fixes?: ReadonlyArray<{ readonly status?: string }> }>;
    };
    const collectedCrashers = existsSync(crashersPath(input.run))
      ? JSON.parse(readFileSync(crashersPath(input.run), "utf8"))
      : [];
    let filedCount = 0;
    let duplicateCount = 0;
    for (const verification of result.verifications ?? []) {
      for (const fix of verification?.fixes ?? []) {
        if (fix?.status === "filed") filedCount += 1;
        else if (fix?.status === "duplicate") duplicateCount += 1;
      }
    }
    const summary = {
      resolved: result.resolved,
      iterations: result.iterations,
      crashers: collectedCrashers.length,
      filed: filedCount,
      duplicates: duplicateCount,
      remaining: result.remaining.length,
      verifications: result.verifications
    };
    writeReport(input.run, summary);

    if (!result.resolved) {
      return yield* Effect.fail(
        new StepFailed({
          step: "campaign",
          message: `fuzz-campaign left ${result.remaining.length} unrecorded crasher(s)`
        })
      );
    }

    return {
      step: "campaign",
      ok: true,
      resolved: result.resolved,
      filed: filedCount,
      duplicates: duplicateCount,
      summary: `resolved=${result.resolved} crashers=${collectedCrashers.length} filed=${filedCount} duplicates=${duplicateCount}`
    };
  });

/** The steps' implementations, which the durable host composes. */
export const layer = Layer.mergeAll(
  Prepare.toLayer(runPrepare, { implementationVersion }),
  Scan.toLayer(runScan, { implementationVersion }),
  Fix.toLayer(runFix, { implementationVersion }),
  Verify.toLayer(runVerify, { implementationVersion }),
  Report.toLayer(runReport, { implementationVersion })
);

export const campaignLoop = ScanFixVerify.make({
  name: "fuzz-campaign-loop",
  description: "Scan crashers in CommandSandbox, file or deduplicate findings, and verify every crasher is recorded",
  scan: Scan,
  fix: Fix,
  verify: Verify,
  maxRetries: 2,
  maxIssues: 16,
  concurrency: 1
});

export default Flow.make("fuzz-campaign", {
  description: "Run a fuzz campaign in a CommandSandbox over ScanFixVerify, collect crashers, file or deduplicate findings, and verify every crasher is recorded",
  capabilities: [],
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: Schema.Unknown,
  body: Node.capture({ implementationVersion }, (input: StartInput) =>
    Prepare.call(input).pipe(
      Node.andThen(
        Node.bindPlanned(
          campaignLoop.call({ input }),
          Node.capture({ implementationVersion }, (report) => Report.call({ input, report }))
        )
      )
    )
  )
});
