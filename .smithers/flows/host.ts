// Shared durable Smithers flow host for VibeLang (#477).
//
// Defaults to the workspace durable SQLite store (`<root>/.flows/engine.db`
// with its companion `<root>/.flows/control.db` index) via `@smthrs/platform-node`
// and `@smthrs/control`, so `smthrs runs list` and `smthrs runs show` track every
// flow execution. Pass `{ memory: true }` or `--memory` for isolated tests and
// evals that want ephemeral in-memory execution with zero disk state.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Layer, Logger, Option, References } from "effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { ApprovalAuthority, ControlRuntime, SqlControlRuntime } from "@smthrs/control";
import * as ControlMigrations from "@smthrs/control/Migrations";
import { WebCrypto } from "@smthrs/crypto";
import * as DurableWriter from "@smthrs/database/DurableWriter";
import * as DatabaseMigrations from "@smthrs/database/Migrations";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import * as Runtime from "@smthrs/flows/Runtime";
import * as MemoryMigrations from "@smthrs/memory/Migrations";
import { NativeRuntime, NodeHost, NodeRuntime } from "@smthrs/platform-node";
import * as TimeTravelMigrations from "@smthrs/time-travel/Migrations";

export interface RunnableFlow<P, A, E> {
  readonly _tag: string;
  readonly description?: string | undefined;
  readonly execute: (payload: P, options: { readonly executionId: string }) => Effect.Effect<A, E, any>;
}

export type LogLevelName = "All" | "Trace" | "Debug" | "Info" | "Warning" | "Error" | "Fatal" | "None";

export interface HostOptions {
  /** Use the ephemeral in-memory engine (no `.flows/` files). Defaults to false (durable SQLite). */
  readonly memory?: boolean | undefined;
  /** Workspace root whose `.flows/{engine,control}.db` store holds durable runs. */
  readonly root?: string | undefined;
  /** Explicit engine SQLite database file (defaults to `<root>/.flows/engine.db`). */
  readonly db?: string | undefined;
  /** Explicit control SQLite database file (defaults to `control.db` beside `db`). */
  readonly controlDb?: string | undefined;
  /** Explicit execution/run ID (defaults to `<flow>-<timestamp>-<uuid8>`). */
  readonly executionId?: string | undefined;
  /** Host identity recorded on durable leases (defaults to `os.hostname()`). */
  readonly hostId?: string | undefined;
  /** Flow description stamped into the control plan card. */
  readonly description?: string | undefined;
  /** Minimum log level emitted to stderr during execution (defaults to `"Warning"`). */
  readonly logLevel?: LogLevelName | undefined;
}

const isBun = typeof (globalThis as { readonly Bun?: unknown }).Bun !== "undefined";
const smithersDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const defaultRoot = (): string => resolve(smithersDir, "..");

export const defaultDatabase = (root: string = defaultRoot()): string =>
  join(resolve(root), ".flows", "engine.db");

export const defaultControlDatabase = (engineDb: string): string =>
  join(dirname(resolve(engineDb)), "control.db");

const cliEngineVersion = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(join(smithersDir, "node_modules/@smthrs/cli/package.json"), "utf8")) as {
      readonly version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "1.0.0-rc.18";
  } catch {
    return "1.0.0-rc.18";
  }
};

const openSqlDriver = (filename: string): Layer.Layer<SqlClient.SqlClient> =>
  Layer.unwrap(
    Effect.promise(async () => {
      if (isBun) {
        const mod = await import("@smthrs/database/bun/BunDatabase");
        return mod.layer({ filename });
      }
      const mod = await import("@smthrs/database/node/NodeDatabase");
      return mod.layer({ filename });
    }),
  );

const nativeHostRuntime = isBun
  ? NativeRuntime.make({
      name: "BunRuntime",
      database: (filename: string) =>
        NodeRuntime.publishFreshDatabase(filename, openSqlDriver, Runtime.storage),
      host: NodeHost,
      crypto: NodeHost.NodeCrypto.layer,
    })
  : NodeRuntime;

const controlMigrations = DatabaseMigrations.layer([
  ...TimeTravelMigrations.sets,
  ControlMigrations.set,
  MemoryMigrations.set,
]);

/** Peels host flags (`--memory`, `--durable`, `--root`, `--db`, `--control-db`, `--execution-id`) off an argv list. */
export function parseHostFlags(argv: ReadonlyArray<string>): {
  readonly options: HostOptions;
  readonly rest: Array<string>;
} {
  let memory: boolean | undefined;
  let root: string | undefined;
  let db: string | undefined;
  let controlDb: string | undefined;
  let executionId: string | undefined;
  const rest: Array<string> = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (arg === "--memory") {
      memory = true;
      continue;
    }
    if (arg === "--durable") {
      memory = false;
      continue;
    }
    const nextValue = (flag: string): string | undefined => {
      if (arg === flag && i + 1 < argv.length) {
        i += 1;
        return argv[i]!;
      }
      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1);
      }
      return undefined;
    };
    const rootVal = nextValue("--root");
    if (rootVal !== undefined) {
      root = resolve(rootVal);
      continue;
    }
    const dbVal = nextValue("--db");
    if (dbVal !== undefined) {
      db = dbVal === ":memory:" ? dbVal : resolve(dbVal);
      continue;
    }
    const controlDbVal = nextValue("--control-db");
    if (controlDbVal !== undefined) {
      controlDb = resolve(controlDbVal);
      continue;
    }
    const execVal = nextValue("--execution-id");
    if (execVal !== undefined) {
      executionId = execVal;
      continue;
    }
    rest.push(arg);
  }

  return {
    options: {
      ...(memory === undefined ? {} : { memory }),
      ...(root === undefined ? {} : { root }),
      ...(db === undefined ? {} : { db }),
      ...(controlDb === undefined ? {} : { controlDb }),
      ...(executionId === undefined ? {} : { executionId }),
    },
    rest,
  };
}

/** Composes a flow and its action implementations on the ephemeral in-memory engine. */
export const memoryRuntime = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
) =>
  Interpreter.layerWithImplementations(flow as never, implementations as never).pipe(
    Layer.provideMerge(FlowEngine.layerMemory),
    Layer.provideMerge(WebCrypto.layer),
  );

/** Composes a flow and its action implementations on the durable SQLite host (`@smthrs/platform-node`). */
export const durableRuntime = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
  options: HostOptions = {},
) => {
  const workspaceRoot = resolve(options.root ?? defaultRoot());
  const filename = options.db ?? defaultDatabase(workspaceRoot);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  return nativeHostRuntime.layerHost(
    {
      filename,
      workspaceRoot,
      owner: { hostId: options.hostId ?? hostname() },
      signals: [],
    },
    Interpreter.layerWithImplementations(flow as never, implementations as never),
  );
};

/** Composes the shared host runtime — durable SQLite by default, or in-memory when `options.memory` is true. */
export const runtime = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
  options: HostOptions = {},
) => (options.memory === true ? memoryRuntime(flow, implementations) : durableRuntime(flow, implementations, options));

const durableControlLayer = <P, A, E>(
  flow: RunnableFlow<P, A, E>,
  controlDb: string,
  options: HostOptions,
) => {
  mkdirSync(dirname(controlDb), { recursive: true });
  const controlSql = NodeRuntime.publishFreshDatabase(controlDb, openSqlDriver, controlMigrations);
  return SqlControlRuntime.layerWithStore({
    approvalAuthority: ApprovalAuthority.local,
    engineVersion: cliEngineVersion(),
    flows: [
      {
        flowId: flow._tag,
        description: options.description ?? flow.description ?? flow._tag,
        deployClass: false,
        envelope: { capabilities: [], flows: [], budget: {} },
      },
    ],
  }).pipe(
    Layer.provideMerge(DurableWriter.layer()),
    Layer.provideMerge(controlMigrations),
    Layer.provideMerge(controlSql),
    Layer.provide(NodeHost.NodeCrypto.layer),
  );
};

const normalizeOptions = (optionsOrId?: HostOptions | string): HostOptions =>
  typeof optionsOrId === "string" ? { executionId: optionsOrId } : optionsOrId ?? {};

const makeExecutionId = (flowTag: string, explicit?: string): string =>
  explicit ?? `${flowTag}-${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Executes a flow as an Effect on the shared host (durable SQLite + `smthrs runs list` tracking by default, or `--memory`). */
export const executeEffect = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
  payload: P,
  optionsOrId?: HostOptions | string,
): Effect.Effect<A, E> => {
  const options = normalizeOptions(optionsOrId);
  const executionId = makeExecutionId(flow._tag, options.executionId);
  const logLevel = options.logLevel ?? "Warning";

  if (options.memory === true) {
    return flow
      .execute(payload, { executionId })
      .pipe(
        Effect.provide(memoryRuntime(flow, implementations)),
        Effect.provideService(Logger.LogToStderr, true),
        Effect.provideService(References.MinimumLogLevel, logLevel),
      ) as Effect.Effect<A, E>;
  }

  const workspaceRoot = resolve(options.root ?? defaultRoot());
  const engineDb = options.db ?? defaultDatabase(workspaceRoot);
  const engineLayer = durableRuntime(flow, implementations, { ...options, root: workspaceRoot, db: engineDb });

  if (engineDb === ":memory:") {
    return flow
      .execute(payload, { executionId })
      .pipe(
        Effect.provide(engineLayer),
        Effect.scoped,
        Effect.provideService(Logger.LogToStderr, true),
        Effect.provideService(References.MinimumLogLevel, logLevel),
      ) as Effect.Effect<A, E>;
  }

  const controlDb = options.controlDb ?? defaultControlDatabase(engineDb);
  const controlLayer = durableControlLayer(flow, controlDb, options);

  const tracked = Effect.gen(function* () {
    const ctrl = yield* ControlRuntime.ControlRuntime;
    const planned = yield* ctrl.plan({ flowId: flow._tag, input: payload });
    const card = planned.card;
    const principal = yield* ctrl.stampPrincipal();
    const token = yield* ctrl.lookupApproval({
      _tag: "Plan",
      planId: card.planId,
      digest: card.digest,
      envelope: card.envelope,
    });
    yield* ctrl.resolveApproval(token, "approved", principal, "once");
    const launched = yield* ctrl.launch(card.planId, card.digest, card.envelope, principal, executionId);
    if (launched._tag !== "Started") {
      return yield* Effect.die(new Error(`Shared host could not start control run for ${flow._tag}: ${launched.receipt._tag}`));
    }
    const fence = yield* ctrl.claimFence(launched.run.runId);
    const exit = yield* Effect.exit(flow.execute(payload, { executionId: launched.run.runId }));
    yield* ctrl.writeStatus(launched.run.runId, fence, Exit.isSuccess(exit) ? "completed" : "failed");
    return yield* exit;
  });

  return tracked.pipe(
    Effect.provide(Layer.merge(engineLayer, controlLayer)),
    Effect.scoped,
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provideService(References.MinimumLogLevel, logLevel),
  ) as Effect.Effect<A, E>;
};

/** Executes a flow once on the shared host and returns its Exit. */
export const execute = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
  payload: P,
  optionsOrId?: HostOptions | string,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(executeEffect(flow, implementations, payload, optionsOrId));

type RegisteredFlowName = "ci-health" | "docs" | "effect-bump" | "migrate" | "release" | "site-deploy" | "spec-review" | "ts-bump";

const loadBuiltinFlow = async (name: RegisteredFlowName): Promise<{
  readonly flow: RunnableFlow<unknown, unknown, unknown>;
  readonly layer: Layer.Layer<unknown, unknown, unknown>;
  readonly defaultPayload?: (() => Promise<unknown>) | undefined;
}> => {
  switch (name) {
    case "ci-health": {
      const mod = await import("./ci-health/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
    case "docs": {
      const mod = await import("./docs/flow.ts");
      const gen = await import("./docs/generate.ts");
      return {
        flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>,
        layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown>,
        defaultPayload: async () => ({ sources: await gen.readSources() }),
      };
    }
    case "effect-bump": {
      const mod = await import("./effect-bump/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
    case "migrate": {
      const mod = await import("./migrate/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
    case "release": {
      const mod = await import("./release/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
    case "site-deploy": {
      const mod = await import("./site-deploy/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
    case "spec-review": {
      const mod = await import("./spec-review/flow.ts");
      return {
        flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>,
        layer: mod.actions.pipe(Layer.provide(mod.commandReviewers)) as unknown as Layer.Layer<unknown, unknown, unknown>,
      };
    }
    case "ts-bump": {
      const mod = await import("./ts-bump/flow.ts");
      return { flow: mod.default as unknown as RunnableFlow<unknown, unknown, unknown>, layer: mod.layer as unknown as Layer.Layer<unknown, unknown, unknown> };
    }
  }
};

const isMain = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
};

if (isMain()) {
  const { options, rest } = parseHostFlags(process.argv.slice(2));
  const [flowName, ...tail] = rest;
  const known: ReadonlyArray<RegisteredFlowName> = [
    "ci-health",
    "docs",
    "effect-bump",
    "migrate",
    "release",
    "site-deploy",
    "spec-review",
    "ts-bump",
  ];
  if (!flowName || !known.includes(flowName as RegisteredFlowName)) {
    console.error(
      `usage: bun .smithers/flows/host.ts <${known.join("|")}> [--memory] [--root <dir>] [--db <file>] [--execution-id <id>] [--data <json>]`,
    );
    process.exit(2);
  }
  let rawData: string | undefined;
  for (let i = 0; i < tail.length; i++) {
    const arg = tail[i]!;
    if (arg === "--data" && i + 1 < tail.length) {
      rawData = tail[++i]!;
    } else if (arg.startsWith("--data=")) {
      rawData = arg.slice("--data=".length);
    }
  }
  const loaded = await loadBuiltinFlow(flowName as RegisteredFlowName);
  const payload = rawData !== undefined
    ? (JSON.parse(rawData) as unknown)
    : loaded.defaultPayload !== undefined
      ? await loaded.defaultPayload()
      : {};
  const exit = await execute(loaded.flow, loaded.layer, payload, options);
  if (Exit.isSuccess(exit)) {
    console.log(JSON.stringify(exit.value, null, 2));
  } else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `${flowName}: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
