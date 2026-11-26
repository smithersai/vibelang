import { Action, Flow } from "@smthrs/flow";
import { ScanFixVerify } from "@smthrs/patterns";
import { Node } from "@smthrs/plan";
import { NodeChildProcessSpawner } from "@smthrs/platform-node/NodeHost";
import { CommandSandbox } from "@smthrs/sandbox";
import { Effect, Layer, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { mkdirSync, writeFileSync } from "node:fs";
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

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Prepare = declare("fuzz-campaign/Prepare", StartPayload);
export const Campaign = declare("fuzz-campaign/Campaign", StartPayload);

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
  input: Schema.Struct.Type<typeof StartPayload>,
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

const runPrepare = (input: Schema.Struct.Type<typeof StartPayload>) =>
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

const runCampaign = (input: Schema.Struct.Type<typeof StartPayload>) =>
  withSandbox(input, "campaign", (session) =>
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

      let collectedCrashers: Array<any> = [];
      let filedCount = 0;
      let duplicateCount = 0;
      let executedCampaign = false;

      const report = yield* ScanFixVerify.run(input, {
        maxRetries: 2,
        concurrency: 1,
        scan: ({ iteration }) =>
          Effect.gen(function* () {
            if (!executedCampaign) {
              executedCampaign = true;
              const res = yield* execInSession(
                session,
                `mkdir -p ${shellQuote(remoteOut)} && CAMPAIGN_OUT=${shellQuote(remoteOut)} ${campaignCmd}`
              );
              const combinedLog = `${res.stdout}${res.stderr}`;
              writeFileSync(path.join(localLogsDir, "campaign.log"), combinedLog, "utf8");

              // Pull summary.txt if present
              const summaryText = yield* session.readFile(path.posix.join(remoteOut, "summary.txt")).pipe(
                Effect.map((bytes) => decoder.decode(bytes)),
                Effect.catch(() => Effect.succeed(""))
              );
              if (summaryText) writeFileSync(path.join(localLogsDir, "summary.txt"), summaryText, "utf8");

              // List and pull back every crasher and target log via session.readFile
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

              collectedCrashers = collectLocalCrashers(localCrashersDir, localLogsDir);
              const classified = classifyCampaignResult({
                exitCode: res.exitCode,
                summaryText,
                logText: combinedLog,
                crashers: collectedCrashers
              });
              return classified.crashers;
            }
            // Confirming rescan: return only crashers that still lack a finding record.
            const verified = verifyCrashers(input.findings, collectedCrashers);
            return verified.missing;
          }),
        fix: ({ issue }) =>
          Effect.sync(() => {
            const rec = fileFinding(input.findings, issue);
            if (rec.status === "filed") filedCount += 1;
            else duplicateCount += 1;
            return rec;
          }),
        verify: ({ issues }) =>
          Effect.sync(() => verifyCrashers(input.findings, issues))
      });

      const summary = {
        resolved: report.resolved,
        iterations: report.iterations,
        crashers: collectedCrashers.length,
        filed: filedCount,
        duplicates: duplicateCount,
        remaining: report.remaining.length,
        verifications: report.verifications
      };
      writeReport(input.run, summary);

      if (!report.resolved) {
        return yield* Effect.fail(
          new StepFailed({
            step: "campaign",
            message: `fuzz-campaign left ${report.remaining.length} unrecorded crasher(s)`
          })
        );
      }

      return {
        step: "campaign",
        ok: true,
        resolved: report.resolved,
        filed: filedCount,
        duplicates: duplicateCount,
        summary: `resolved=${report.resolved} crashers=${collectedCrashers.length} filed=${filedCount} duplicates=${duplicateCount}`
      };
    })
  );

/** The steps' implementations, which the durable host composes. */
export const layer = Layer.mergeAll(
  Prepare.toLayer(runPrepare, { implementationVersion }),
  Campaign.toLayer(runCampaign, { implementationVersion })
);

export default Flow.make("fuzz-campaign", {
  description: "Run a fuzz campaign in a CommandSandbox over ScanFixVerify, collect crashers, file or deduplicate findings, and verify every crasher is recorded",
  capabilities: [],
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) =>
    Prepare.call(input).pipe(Node.andThen(Campaign.call(input)))
  )
});
