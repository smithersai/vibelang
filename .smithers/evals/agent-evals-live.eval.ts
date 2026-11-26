import { CaseExecutor, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeWorkdir, hashValue, listTasks, prepareWorkdir, stepKeyFor } from "./agent-evals/lib.mjs";

// Live coding-agent evaluation suite (#466):
// Replaces scripts/agent-evals/run.mjs with a @smthrs/evals Suite.
// Spawns configured coding-agent CLIs against each task with/without
// `vibelang agents init`, grades from outside, and records transcripts.
// (Moving CLI invocation to @smthrs/agent ExternalAgent waits on #4570.)

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const AGENT_CMDS: Record<string, (prompt: string, usingSkill: boolean) => ReadonlyArray<string>> = {
  claude: (prompt, usingSkill) => [
    "claude", "-p", prompt, "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose",
    ...(usingSkill ? ["--plugin-dir", ".claude/skills/vibelang-lsp"] : [])
  ],
  codex: (prompt, usingSkill) => [
    "codex", "exec", ...(usingSkill ? ["--dangerously-bypass-hook-trust"] : []),
    "-m", "gpt-6.1-sol", "-s", "workspace-write", "--json", prompt
  ],
  opencode: (prompt) => [
    "opencode", "run", "-m", "kimi-code-plan-global/k3", "--auto", "--format", "json", prompt
  ]
};

type LiveInput = { readonly task: string; readonly agent: string; readonly condition: "with" | "without" };

const selectedTasks = process.env.AGENT_EVALS_TASKS
  ? process.env.AGENT_EVALS_TASKS.split(",").map((s) => s.trim()).filter(Boolean)
  : listTasks(repo);

const selectedAgents = process.env.AGENT_EVALS_AGENTS
  ? process.env.AGENT_EVALS_AGENTS.split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(AGENT_CMDS);

const selectedConditions: ReadonlyArray<"with" | "without"> = process.env.AGENT_EVALS_CONDITIONS
  ? (process.env.AGENT_EVALS_CONDITIONS.split(",").map((s) => s.trim()).filter((s): s is "with" | "without" => s === "with" || s === "without"))
  : ["with", "without"];

const target = { name: "agent-evals-live" };

const scorer = Scorer.make({
  id: "agent-evals-live/pass",
  version: "1",
  name: "pass",
  score: ({ output }) => {
    const actual = output as { pass: boolean; sawDiagnostic: boolean; diagnosticCodes: Array<string> };
    return Effect.succeed({
      score: actual.pass ? 1 : 0,
      meta: {
        pass: actual.pass,
        sawDiagnostic: actual.sawDiagnostic,
        diagnosticCodes: actual.diagnosticCodes
      }
    });
  }
});

const cases = selectedTasks.flatMap((task) =>
  selectedAgents.flatMap((agent) =>
    selectedConditions.map((condition) => ({
      name: `${task}/${agent}/${condition}`,
      input: { task, agent, condition } satisfies LiveInput
    }))
  )
);

export const suite = Suite.make({
  name: "agent-evals-live",
  cases,
  bindings: [Binding.make({ scorer, appliesTo: target })],
  concurrency: Number(process.env.AGENT_EVALS_CONCURRENCY ?? 2)
});

export const executor = CaseExecutor.make((c) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const input = c.input as LiveInput;
    const cmdBuilder = AGENT_CMDS[input.agent];
    if (!cmdBuilder) throw new Error(`agent-evals-live: unknown agent ${input.agent}`);

    const outBase = process.env.AGENT_EVALS_DIR ? resolve(process.env.AGENT_EVALS_DIR) : undefined;
    const runDir = outBase ? join(outBase, "runs", `${input.task}-${input.agent}-${input.condition}-${Date.now()}`) : undefined;
    if (runDir) mkdirSync(runDir, { recursive: true });

    const prepared = prepareWorkdir(repo, input.task, "base", runDir);
    try {
      if (input.condition === "with") {
        const init = spawnSync(process.execPath, [join(prepared.dir, "node_modules/.bin/vibelang"), "agents", "init"], {
          cwd: prepared.dir,
          env: { ...process.env, VIBELANG_BINARY: prepared.toolchain.binary },
          encoding: "utf8",
          timeout: 60_000
        });
        if (init.status !== 0) {
          throw new Error(`vibelang agents init failed: ${init.stdout}${init.stderr}`);
        }
      }

      const [command, ...args] = cmdBuilder(prepared.spec.prompt, input.condition === "with");
      const agentRun = spawnSync(command, args, {
        cwd: prepared.dir,
        env: { ...process.env, PWD: prepared.dir },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: Number(process.env.AGENT_EVALS_TIMEOUT_MS ?? 25 * 60_000)
      });
      const transcript = `${agentRun.stdout ?? ""}`;
      if (runDir) {
        writeFileSync(`${runDir}.transcript.jsonl`, transcript, "utf8");
        writeFileSync(`${runDir}.stderr`, `${agentRun.stderr ?? ""}`, "utf8");
      }

      const graded = gradeWorkdir(prepared.dir, prepared.spec, prepared.testDigestBefore, prepared.toolchain, transcript);
      const output = {
        ...input,
        agentExit: agentRun.status ?? agentRun.signal ?? -1,
        ...graded
      };
      return {
        output,
        stepKey: hashValue({ base: stepKeyFor(repo, input.task, "base"), agent: input.agent, condition: input.condition }),
        latencyMs: Date.now() - started,
        target
      };
    } finally {
      if (!outBase) rmSync(prepared.dir, { recursive: true, force: true });
    }
  })
);
