import {
  Action,
  Deployment,
  DurableExecutor,
  DurableStore,
  Flow,
  Provider,
  Worker,
} from "../../src/durable/index.ts";

const [mode, databaseFile] = Bun.argv.slice(2);
if ((mode !== "crash-after-success" && mode !== "resume-with-poison-provider") || !databaseFile) {
  throw new TypeError("usage: durable-process-crash-runner <crash-after-success|resume-with-poison-provider> <database>");
}

const Work = Action.define<{ value: number }, { doubled: number }>({
  id: "test/RealProcessCrash/Work",
  version: 1,
});
const Program = Flow.define<{ value: number }, { doubled: number }>(
  { id: "test/RealProcessCrash/Flow", version: 1 },
  (input) => Work.run({ value: input.value }),
);
const Live = Provider.provide(Work, ({ value }) => {
  if (mode === "resume-with-poison-provider") {
    throw new Error("committed node was incorrectly invoked after process restart");
  }
  return { doubled: value * 2 };
}, {
  implementationId: "real-process-crash-work",
  implementationVersion: "1",
  recovery: { mode: "repeatable", maxAttempts: 2 },
});
const deployment = Deployment.build({
  id: "real-process-crash-deployment",
  flow: Program,
  pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
});

const store = new DurableStore(databaseFile);
const executorStore = mode === "crash-after-success"
  ? new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        if (property === "commitSuccess" && result === true) {
          // Deliberately do not close SQLite or flush application state. The
          // transaction has returned from COMMIT; the coordinator disappears
          // before it can observe/adopt that result.
          process.kill(process.pid, "SIGKILL");
          throw new Error("SIGKILL did not terminate the process");
        }
        return result;
      };
    },
  })
  : store;

const result = await new DurableExecutor(deployment, executorStore).execute(
  { value: 4 },
  { executionId: "real-process-crash", leaseMs: 25 },
);
if (mode === "crash-after-success") {
  throw new Error("crash injection did not reach commitSuccess");
}
const integrity = store.database.query("PRAGMA integrity_check").get() as Record<string, unknown>;
store.close();
process.stdout.write(`${JSON.stringify({ result, integrity: Object.values(integrity) })}\n`);
