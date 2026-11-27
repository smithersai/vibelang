export type PresetCategory = 'Effect UI' | 'Core Effect' | 'Concurrency' | 'Data' | 'Diagnostics'
export type PreviewMode = 'ui-counter' | 'ui-uploads' | 'console'

export interface PlaygroundPreset {
  readonly id: string
  readonly title: string
  readonly shortTitle: string
  readonly filename: string
  readonly category: PresetCategory
  readonly previewMode: PreviewMode
  readonly summary: string
  readonly source: string
  readonly fallbackTs: string
  readonly fallbackJs: string
  readonly fallbackDts: string
}

export const PLAYGROUND_PRESETS: ReadonlyArray<PlaygroundPreset> = [
  {
    id: 'effect-ui-counter',
    title: 'Effect UI: Counter',
    shortTitle: 'UI: Counter',
    filename: 'counter.vibe',
    category: 'Effect UI',
    previewMode: 'ui-counter',
    summary: 'Schema model, tagged messages, pure exhaustive update, declarative view, and live time-travel state inspector.',
    source: `// Effect UI Counter — pure Model, tagged Msg, exhaustive update & view
schema CounterModel {
  count: number
  step: number
  transitions: number
}

data CounterMsg {
  Increment
  Decrement
  SetStep { step: number }
  Reset
}

export const initialModel: CounterModel = {
  count: 0,
  step: 1,
  transitions: 0,
}

export function update(model: CounterModel, msg: CounterMsg): CounterModel {
  return match (msg) {
    when { _tag: "Increment" }: {
      ...model,
      count: model.count + model.step,
      transitions: model.transitions + 1,
    };
    when { _tag: "Decrement" }: {
      ...model,
      count: model.count - model.step,
      transitions: model.transitions + 1,
    };
    when { _tag: "SetStep", let step }: {
      ...model,
      step,
      transitions: model.transitions + 1,
    };
    when { _tag: "Reset" }: {
      count: 0,
      step: model.step,
      transitions: model.transitions + 1,
    };
  }
}

export function viewSummary(model: CounterModel): string {
  return \`count=\${model.count} (step \${model.step}, \${model.transitions} updates)\`
}

export effect function main() {
  let state = initialModel
  state = update(state, CounterMsg.SetStep({ step: 5 }))
  state = update(state, CounterMsg.Increment())
  state = update(state, CounterMsg.Increment())
  try Console.log("Counter state:", viewSummary(state))
  return state
}
`,
    fallbackTs: `import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

export const CounterModel = Schema.Struct({
  count: Schema.mutableKey(Schema.Number),
  step: Schema.mutableKey(Schema.Number),
  transitions: Schema.mutableKey(Schema.Number),
})
export type CounterModel = typeof CounterModel.Type

export type CounterMsg = Data.TaggedEnum<{
  readonly Increment: {}
  readonly Decrement: {}
  readonly SetStep: { readonly step: number }
  readonly Reset: {}
}>
export const CounterMsg = Data.taggedEnum<CounterMsg>()

export const initialModel: CounterModel = {
  count: 0,
  step: 1,
  transitions: 0,
}

export function update(model: CounterModel, msg: CounterMsg): CounterModel {
  return Match.value(msg).pipe(
    Match.tag("Increment", () => ({
      ...model,
      count: model.count + model.step,
      transitions: model.transitions + 1,
    })),
    Match.tag("Decrement", () => ({
      ...model,
      count: model.count - model.step,
      transitions: model.transitions + 1,
    })),
    Match.tag("SetStep", ({ step }) => ({
      ...model,
      step,
      transitions: model.transitions + 1,
    })),
    Match.tag("Reset", () => ({
      count: 0,
      step: model.step,
      transitions: model.transitions + 1,
    })),
    Match.exhaustive
  )
}

export function viewSummary(model: CounterModel): string {
  return \`count=\${model.count} (step \${model.step}, \${model.transitions} updates)\`
}

export function main(): Effect.Effect<CounterModel> {
  return Effect.gen(function* () {
    let state = initialModel
    state = update(state, CounterMsg.SetStep({ step: 5 }))
    state = update(state, CounterMsg.Increment())
    state = update(state, CounterMsg.Increment())
    yield* Console.log("Counter state:", viewSummary(state))
    return state
  })
}
`,
    fallbackJs: `import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
const CounterModel = Schema.Struct({
  count: Schema.mutableKey(Schema.Number),
  step: Schema.mutableKey(Schema.Number),
  transitions: Schema.mutableKey(Schema.Number),
});
const CounterMsg = Data.taggedEnum();
export const initialModel = { count: 0, step: 1, transitions: 0 };
export function update(model, msg) {
  if (msg._tag === "Increment") return { ...model, count: model.count + model.step, transitions: model.transitions + 1 };
  if (msg._tag === "Decrement") return { ...model, count: model.count - model.step, transitions: model.transitions + 1 };
  if (msg._tag === "SetStep") return { ...model, step: msg.step, transitions: model.transitions + 1 };
  if (msg._tag === "Reset") return { count: 0, step: model.step, transitions: model.transitions + 1 };
  throw new Error("Unhandled CounterMsg");
}
export function viewSummary(model) {
  return \`count=\${model.count} (step \${model.step}, \${model.transitions} updates)\`;
}
export function main() {
  return Effect.gen(function* () {
    let state = initialModel;
    state = update(state, CounterMsg.SetStep({ step: 5 }));
    state = update(state, CounterMsg.Increment());
    state = update(state, CounterMsg.Increment());
    yield* Console.log("Counter state:", viewSummary(state));
    return state;
  });
}
`,
    fallbackDts: `import type * as Effect from "effect/Effect";
export declare const initialModel: { count: number; step: number; transitions: number };
export declare function update(model: CounterModel, msg: CounterMsg): CounterModel;
export declare function viewSummary(model: CounterModel): string;
export declare function main(): Effect.Effect<CounterModel, never, never>;
`,
  },
  {
    id: 'effect-ui-uploads',
    title: 'Effect UI: Concurrent Uploads',
    shortTitle: 'UI: Uploads',
    filename: 'uploads.vibe',
    category: 'Effect UI',
    previewMode: 'ui-uploads',
    summary: 'Schema-typed upload state, Command.Service with switch-mode fiber interruption, and exhaustive match(upload.status).',
    source: `// Effect UI Concurrent Uploads — switch-mode fiber cancellation & exhaustive status matching
schema UploadStatus = "idle" | "uploading" | "done" | "cancelled" | "failed"

schema Upload {
  id: string
  name: string
  sizeMb: number
  progress: number
  status: UploadStatus
  attempt: number
}

error UploadFailed {
  id: string
  reason: string
}

data UploadMsg {
  Start { id: string }
  Progress { id: string; pct: number }
  Complete { id: string }
  Cancel { id: string }
  Restart { id: string }
  Fail { id: string; reason: string }
}

// Command.Service runs keyed Effect fibers; "switch" mode interrupts any prior fiber on restart.
service UploadCommand {
  run(id: string, mode: "switch" | "parallel"): void!UploadFailed
}

export const initialUploads: ReadonlyArray<Upload> = [
  { id: "u1", name: "vibelang-0.0.14.tar.gz", sizeMb: 18, progress: 0, status: "idle", attempt: 0 },
  { id: "u2", name: "effect-ui-demo.mp4", sizeMb: 42, progress: 0, status: "idle", attempt: 0 },
  { id: "u3", name: "playground.wasm", sizeMb: 12, progress: 0, status: "idle", attempt: 0 },
]

export function statusBadge(upload: Upload): { readonly label: string; readonly tone: string; readonly action: string } {
  return match (upload.status) {
    when "idle": { label: "Ready", tone: "neutral", action: "Start" };
    when "uploading": { label: \`Uploading \${upload.progress}%\`, tone: "accent", action: "Cancel" };
    when "done": { label: "Uploaded", tone: "success", action: "Restart" };
    when "cancelled": { label: "Cancelled", tone: "warn", action: "Restart" };
    when "failed": { label: "Failed", tone: "danger", action: "Retry" };
  }
}

export function updateUpload(upload: Upload, msg: UploadMsg): Upload {
  return match (msg) {
    when { _tag: "Start", let id }: id === upload.id
      ? { ...upload, status: "uploading", progress: 8, attempt: upload.attempt + 1 }
      : upload;
    when { _tag: "Progress", let id, let pct }: id === upload.id && upload.status === "uploading"
      ? { ...upload, progress: pct }
      : upload;
    when { _tag: "Complete", let id }: id === upload.id
      ? { ...upload, status: "done", progress: 100 }
      : upload;
    when { _tag: "Cancel", let id }: id === upload.id
      ? { ...upload, status: "cancelled" }
      : upload;
    when { _tag: "Restart", let id }: id === upload.id
      ? { ...upload, status: "uploading", progress: 5, attempt: upload.attempt + 1 }
      : upload;
    when { _tag: "Fail", let id }: id === upload.id
      ? { ...upload, status: "failed" }
      : upload;
  }
}

const CommandLive = Layer.succeed(UploadCommand, {
  run: effect (id: string, mode: "switch" | "parallel") => {
    try Console.log(\`Command.Service[\${mode}] started fiber for \${id}\`)
    try sleep("25 millis")
  },
})

export effect function main() {
  provide CommandLive {
    const cmd = try UploadCommand
    try cmd.run("u1", "switch")
    const started = updateUpload(initialUploads[0], UploadMsg.Start({ id: "u1" }))
    const badge = statusBadge(started)
    try Console.log(started.name, "->", badge.label)
    return started
  }
}
`,
    fallbackTs: `import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

export const UploadStatus = Schema.Literals(["idle", "uploading", "done", "cancelled", "failed"])
export type UploadStatus = typeof UploadStatus.Type

export const Upload = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  sizeMb: Schema.mutableKey(Schema.Number),
  progress: Schema.mutableKey(Schema.Number),
  status: Schema.mutableKey(UploadStatus),
  attempt: Schema.mutableKey(Schema.Number),
})
export type Upload = typeof Upload.Type

export class UploadFailed extends Data.TaggedError("UploadFailed")<{
  readonly id: string
  readonly reason: string
}> {}

export type UploadMsg = Data.TaggedEnum<{
  readonly Start: { readonly id: string }
  readonly Progress: { readonly id: string; readonly pct: number }
  readonly Complete: { readonly id: string }
  readonly Cancel: { readonly id: string }
  readonly Restart: { readonly id: string }
  readonly Fail: { readonly id: string; readonly reason: string }
}>
export const UploadMsg = Data.taggedEnum<UploadMsg>()

export class UploadCommand extends Context.Service<
  UploadCommand,
  { readonly run: (id: string, mode: "switch" | "parallel") => Effect.Effect<void, UploadFailed> }
>()("playground/uploads#UploadCommand") {}

export function statusBadge(upload: Upload) {
  return Match.value(upload.status).pipe(
    Match.when("idle", () => ({ label: "Ready", tone: "neutral", action: "Start" })),
    Match.when("uploading", () => ({ label: \`Uploading \${upload.progress}%\`, tone: "accent", action: "Cancel" })),
    Match.when("done", () => ({ label: "Uploaded", tone: "success", action: "Restart" })),
    Match.when("cancelled", () => ({ label: "Cancelled", tone: "warn", action: "Restart" })),
    Match.when("failed", () => ({ label: "Failed", tone: "danger", action: "Retry" })),
    Match.exhaustive
  )
}
`,
    fallbackJs: `import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as runtime from "vibelang-runtime/internal";
const UploadMsg = Data.taggedEnum();
class UploadCommand extends runtime.$service("playground/uploads#UploadCommand") {}
export const initialUploads = [
  { id: "u1", name: "vibelang-0.0.14.tar.gz", sizeMb: 18, progress: 0, status: "idle", attempt: 0 },
  { id: "u2", name: "effect-ui-demo.mp4", sizeMb: 42, progress: 0, status: "idle", attempt: 0 },
  { id: "u3", name: "playground.wasm", sizeMb: 12, progress: 0, status: "idle", attempt: 0 },
];
export function statusBadge(upload) {
  switch (upload.status) {
    case "idle": return { label: "Ready", tone: "neutral", action: "Start" };
    case "uploading": return { label: \`Uploading \${upload.progress}%\`, tone: "accent", action: "Cancel" };
    case "done": return { label: "Uploaded", tone: "success", action: "Restart" };
    case "cancelled": return { label: "Cancelled", tone: "warn", action: "Restart" };
    case "failed": return { label: "Failed", tone: "danger", action: "Retry" };
  }
}
export function updateUpload(upload, msg) {
  if (msg.id !== upload.id) return upload;
  if (msg._tag === "Start") return { ...upload, status: "uploading", progress: 8, attempt: upload.attempt + 1 };
  if (msg._tag === "Progress" && upload.status === "uploading") return { ...upload, progress: msg.pct };
  if (msg._tag === "Complete") return { ...upload, status: "done", progress: 100 };
  if (msg._tag === "Cancel") return { ...upload, status: "cancelled" };
  if (msg._tag === "Restart") return { ...upload, status: "uploading", progress: 5, attempt: upload.attempt + 1 };
  if (msg._tag === "Fail") return { ...upload, status: "failed" };
  return upload;
}
const CommandLive = Layer.succeed(UploadCommand, {
  run: (id, mode) => Effect.gen(function* () {
    yield* Console.log(\`Command.Service[\${mode}] started fiber for \${id}\`);
    yield* Effect.sleep("25 millis");
  }),
});
export function main() {
  return Effect.provide(Effect.gen(function* () {
    const cmd = yield* UploadCommand;
    yield* cmd.run("u1", "switch");
    const started = updateUpload(initialUploads[0], UploadMsg.Start({ id: "u1" }));
    const badge = statusBadge(started);
    yield* Console.log(started.name, "->", badge.label);
    return started;
  }), CommandLive);
}
`,
    fallbackDts: `import type * as Effect from "effect/Effect";
export declare const initialUploads: ReadonlyArray<Upload>;
export declare function statusBadge(upload: Upload): { readonly label: string; readonly tone: string; readonly action: string };
export declare function updateUpload(upload: Upload, msg: UploadMsg): Upload;
export declare function main(): Effect.Effect<Upload, UploadFailed, never>;
`,
  },
  {
    id: 'services-errors',
    title: 'Services & Typed Errors',
    shortTitle: 'Services & Errors',
    filename: 'services.vibe',
    category: 'Core Effect',
    previewMode: 'console',
    summary: 'Declare typed errors and services, wire implementations with Layer.succeed + provide, and recover cleanly with catch.',
    source: `// Services & Typed Errors — compiler-tracked E and R channels
error UserNotFound {
  id: string
}

interface User {
  readonly id: string
  readonly name: string
  readonly role: string
}

service Users {
  find(id: string): User!UserNotFound
}

const UsersLive = Layer.succeed(Users, {
  find: effect (id: string) => {
    if (id === "ada") {
      return { id: "ada", name: "Ada Lovelace", role: "maintainer" }
    }
    if (id === "grace") {
      return { id: "grace", name: "Grace Hopper", role: "compiler-lead" }
    }
    throw new UserNotFound({ id })
  },
})

export effect function greetUser(id: string) {
  const users = try Users
  const user = users.find(id) catch (err) => ({
    id: err.id,
    name: \`Guest (\${err.id})\`,
    role: "visitor",
  })
  return \`[\${user.role}] Hello, \${user.name}!\`
}

export effect function main() {
  provide UsersLive {
    const known = try greetUser("ada")
    const second = try greetUser("grace")
    const recovered = try greetUser("unknown-42")
    try Console.log(known)
    try Console.log(second)
    try Console.log("Recovered via catch:", recovered)
    return { known, second, recovered }
  }
}
`,
    fallbackTs: `import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string
}> {}

interface User {
  readonly id: string
  readonly name: string
  readonly role: string
}

class Users extends Context.Service<
  Users,
  { readonly find: (id: string) => Effect.Effect<User, UserNotFound> }
>()("playground/services#Users") {}

const UsersLive = Layer.succeed(Users, {
  find: (id: string) =>
    Effect.gen(function* () {
      if (id === "ada") return { id: "ada", name: "Ada Lovelace", role: "maintainer" }
      if (id === "grace") return { id: "grace", name: "Grace Hopper", role: "compiler-lead" }
      return yield* Effect.fail(new UserNotFound({ id }))
    }),
})

export function greetUser(id: string): Effect.Effect<string, never, Users> {
  return Effect.gen(function* () {
    const users = yield* Users
    const user = yield* users.find(id).pipe(
      Effect.catchAll((err) =>
        Effect.succeed({ id: err.id, name: \`Guest (\${err.id})\`, role: "visitor" })
      )
    )
    return \`[\${user.role}] Hello, \${user.name}!\`
  })
}

export function main() {
  return Effect.provide(
    Effect.gen(function* () {
      const known = yield* greetUser("ada")
      const second = yield* greetUser("grace")
      const recovered = yield* greetUser("unknown-42")
      yield* Console.log(known)
      yield* Console.log(second)
      yield* Console.log("Recovered via catch:", recovered)
      return { known, second, recovered }
    }),
    UsersLive
  )
}
`,
    fallbackJs: `import * as Console from "effect/Console";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
class UserNotFound extends runtime.TaggedError("UserNotFound") {}
class Users extends runtime.$service("playground/services#Users") {}
const UsersLive = Layer.succeed(Users, {
  find: (id) => Effect.gen(function* () {
    if (id === "ada") return { id: "ada", name: "Ada Lovelace", role: "maintainer" };
    if (id === "grace") return { id: "grace", name: "Grace Hopper", role: "compiler-lead" };
    return yield* Effect.fail(new UserNotFound({ id }));
  }),
});
export function greetUser(id) {
  return Effect.gen(function* () {
    const users = yield* Users;
    const user = yield* runtime.$catch(users.find(id), (err) => Effect.succeed({
      id: err.id,
      name: \`Guest (\${err.id})\`,
      role: "visitor",
    }));
    return \`[\${user.role}] Hello, \${user.name}!\`;
  });
}
export function main() {
  return Effect.provide(Effect.gen(function* () {
    const known = yield* greetUser("ada");
    const second = yield* greetUser("grace");
    const recovered = yield* greetUser("unknown-42");
    yield* Console.log(known);
    yield* Console.log(second);
    yield* Console.log("Recovered via catch:", recovered);
    return { known, second, recovered };
  }), UsersLive);
}
`,
    fallbackDts: `import type * as Effect from "effect/Effect";
export declare function greetUser(id: string): Effect.Effect<string, never, Users>;
export declare function main(): Effect.Effect<{ known: string; second: string; recovered: string }, never, never>;
`,
  },
  {
    id: 'structured-concurrency',
    title: 'Structured Concurrency',
    shortTitle: 'Concurrency',
    filename: 'concurrency.vibe',
    category: 'Concurrency',
    previewMode: 'console',
    summary: 'Overlap Effects with try.all, cancel race losers with try.race, bound batches with for concurrent(3), and fork/join fibers.',
    source: `// Structured Concurrency — fibers, races, and bounded parallel loops
export effect function fetchShard(name: string, delayMs: number) {
  try Console.log(\`[start] \${name} (\${delayMs}ms)\`)
  try sleep(delayMs)
  try Console.log(\`[done]  \${name}\`)
  return \`\${name}:ok\`
}

export effect function main() {
  // 1. Run independent Effects concurrently with automatic failure interruption
  const shards = try.all [
    fetchShard("us-east", 35),
    fetchShard("eu-west", 20),
    fetchShard("ap-south", 45),
  ]

  // 2. Race two replicas — the slower fiber is cleanly interrupted
  const winner = try.race [
    fetchShard("primary-db", 60),
    fetchShard("replica-db", 18),
  ]
  try Console.log("Race winner:", winner)

  // 3. Fork a child fiber and join its typed result later
  const telemetry = fork fetchShard("telemetry-flush", 15)

  // 4. Process a queue with at most 3 fibers in flight at once
  const jobs = ["lint", "typecheck", "bundle", "test", "docs"]
  for concurrent(3) (const job of jobs) {
    try sleep(12)
    try Console.log(\`[job]   \${job} passed\`)
  }

  const flushed = join telemetry
  return { shards, winner, flushed }
}
`,
    fallbackTs: `import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

export function fetchShard(name: string, delayMs: number) {
  return Effect.gen(function* () {
    yield* Console.log(\`[start] \${name} (\${delayMs}ms)\`)
    yield* Effect.sleep(delayMs)
    yield* Console.log(\`[done]  \${name}\`)
    return \`\${name}:ok\`
  })
}

export function main() {
  return Effect.gen(function* () {
    const shards = yield* Effect.all(
      [fetchShard("us-east", 35), fetchShard("eu-west", 20), fetchShard("ap-south", 45)],
      { concurrency: "unbounded" }
    )
    const winner = yield* Effect.raceAllFirst([
      fetchShard("primary-db", 60),
      fetchShard("replica-db", 18),
    ])
    yield* Console.log("Race winner:", winner)
    const telemetry = yield* Effect.forkChild(fetchShard("telemetry-flush", 15))
    const jobs = ["lint", "typecheck", "bundle", "test", "docs"]
    yield* Effect.forEach(
      jobs,
      (job) =>
        Effect.gen(function* () {
          yield* Effect.sleep(12)
          yield* Console.log(\`[job]   \${job} passed\`)
        }),
      { concurrency: 3, discard: true }
    )
    const flushed = yield* Fiber.join(telemetry)
    return { shards, winner, flushed }
  })
}
`,
    fallbackJs: `import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
export function fetchShard(name, delayMs) {
  return Effect.gen(function* () {
    yield* Console.log(\`[start] \${name} (\${delayMs}ms)\`);
    yield* Effect.sleep(delayMs);
    yield* Console.log(\`[done]  \${name}\`);
    return \`\${name}:ok\`;
  });
}
export function main() {
  return Effect.gen(function* () {
    const shards = yield* Effect.all([fetchShard("us-east", 35), fetchShard("eu-west", 20), fetchShard("ap-south", 45)], { concurrency: "unbounded" });
    const winner = yield* Effect.raceAllFirst([fetchShard("primary-db", 60), fetchShard("replica-db", 18)]);
    yield* Console.log("Race winner:", winner);
    const telemetry = yield* Effect.forkChild(fetchShard("telemetry-flush", 15));
    const jobs = ["lint", "typecheck", "bundle", "test", "docs"];
    yield* Effect.forEach(jobs, (job) => Effect.gen(function* () {
      yield* Effect.sleep(12);
      yield* Console.log(\`[job]   \${job} passed\`);
    }), { concurrency: 3, discard: true });
    const flushed = yield* Fiber.join(telemetry);
    return { shards, winner, flushed };
  });
}
`,
    fallbackDts: `import type * as Effect from "effect/Effect";
export declare function fetchShard(name: string, delayMs: number): Effect.Effect<string, never, never>;
export declare function main(): Effect.Effect<{ shards: [string, string, string]; winner: string; flushed: string }, never, never>;
`,
  },
  {
    id: 'pattern-matching-data',
    title: 'Pattern Matching & Data',
    shortTitle: 'Match & Data',
    filename: 'delivery.vibe',
    category: 'Data',
    previewMode: 'console',
    summary: 'Tagged unions with data, literal schemas, compiler-checked exhaustive match, and Hack pipelines (|>).',
    source: `// Pattern Matching & Data — exhaustive match, schemas, and Hack pipes
schema Priority = "low" | "normal" | "urgent"

schema Destination {
  city: string
  region: string
}

data Delivery {
  Waiting
  Sent { tracking: string; priority: Priority; to: Destination }
  Delivered { signedBy: string }
  Rejected { reason: string }
}

export function describe(delivery: Delivery): string {
  return match (delivery) {
    when { _tag: "Waiting" }: "Queued at warehouse";
    when { _tag: "Sent", let tracking, let priority, let to }:
      \`[\${priority}] \${tracking} -> \${to.city}\`;
    when { _tag: "Delivered", let signedBy }: \`Signed by \${signedBy}\`;
    when { _tag: "Rejected", let reason }: \`Rejected: \${reason}\`;
  }
}

function banner(label: string): string {
  return \`>> \${label.toUpperCase()} <<\`
}

export effect function main() {
  const parcel = Delivery.Sent({
    tracking: "pkg-842",
    priority: "urgent",
    to: { city: "Zurich", region: "CH" },
  })
  const headline = parcel |> describe(%) |> banner(%)
  const samples = [
    Delivery.Waiting(),
    parcel,
    Delivery.Delivered({ signedBy: "L. Torvalds" }),
    Delivery.Rejected({ reason: "customs hold" }),
  ]

  for (const item of samples) {
    try Console.log(describe(item))
  }
  try Console.log("Piped headline:", headline)
  return { headline, count: samples.length }
}
`,
    fallbackTs: `import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

const Priority = Schema.Literals(["low", "normal", "urgent"])
type Priority = typeof Priority.Type

const Destination = Schema.Struct({
  city: Schema.mutableKey(Schema.String),
  region: Schema.mutableKey(Schema.String),
})
type Destination = typeof Destination.Type

type Delivery = Data.TaggedEnum<{
  readonly Waiting: {}
  readonly Sent: { readonly tracking: string; readonly priority: Priority; readonly to: Destination }
  readonly Delivered: { readonly signedBy: string }
  readonly Rejected: { readonly reason: string }
}>
const Delivery = Data.taggedEnum<Delivery>()

export function describe(delivery: Delivery): string {
  return Match.value(delivery).pipe(
    Match.tag("Waiting", () => "Queued at warehouse"),
    Match.tag("Sent", ({ tracking, priority, to: { city } }) => \`[\${priority}] \${tracking} -> \${city}\`),
    Match.tag("Delivered", ({ signedBy }) => \`Signed by \${signedBy}\`),
    Match.tag("Rejected", ({ reason }) => \`Rejected: \${reason}\`),
    Match.exhaustive
  )
}

function banner(label: string): string {
  return \`>> \${label.toUpperCase()} <<\`
}

export function main() {
  return Effect.gen(function* () {
    const parcel = Delivery.Sent({
      tracking: "pkg-842",
      priority: "urgent",
      to: { city: "Zurich", region: "CH" },
    })
    const headline = banner(describe(parcel))
    const samples = [
      Delivery.Waiting(),
      parcel,
      Delivery.Delivered({ signedBy: "L. Torvalds" }),
      Delivery.Rejected({ reason: "customs hold" }),
    ]
    for (const item of samples) {
      yield* Console.log(describe(item))
    }
    yield* Console.log("Piped headline:", headline)
    return { headline, count: samples.length }
  })
}
`,
    fallbackJs: `import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
const Delivery = Data.taggedEnum();
export function describe(delivery) {
  if (delivery._tag === "Waiting") return "Queued at warehouse";
  if (delivery._tag === "Sent") return \`[\${delivery.priority}] \${delivery.tracking} -> \${delivery.to.city}\`;
  if (delivery._tag === "Delivered") return \`Signed by \${delivery.signedBy}\`;
  if (delivery._tag === "Rejected") return \`Rejected: \${delivery.reason}\`;
  throw new Error("Non-exhaustive match");
}
function banner(label) {
  return \`>> \${label.toUpperCase()} <<\`;
}
export function main() {
  return Effect.gen(function* () {
    const parcel = Delivery.Sent({ tracking: "pkg-842", priority: "urgent", to: { city: "Zurich", region: "CH" } });
    const headline = banner(describe(parcel));
    const samples = [
      Delivery.Waiting(),
      parcel,
      Delivery.Delivered({ signedBy: "L. Torvalds" }),
      Delivery.Rejected({ reason: "customs hold" }),
    ];
    for (const item of samples) {
      yield* Console.log(describe(item));
    }
    yield* Console.log("Piped headline:", headline);
    return { headline, count: samples.length };
  });
}
`,
    fallbackDts: `import type * as Effect from "effect/Effect";
export declare function describe(delivery: Delivery): string;
export declare function main(): Effect.Effect<{ headline: string; count: number }, never, never>;
`,
  },
  {
    id: 'diagnostics-lab',
    title: 'Diagnostics Lab (EK Codes)',
    shortTitle: 'Diagnostics Lab',
    filename: 'diagnostics.vibe',
    category: 'Diagnostics',
    previewMode: 'console',
    summary: 'Intentional VibeLang diagnostics (EK0101, EK0909, EK3003, EK0502). Click any diagnostic to jump to its line and fix it live.',
    source: `// Diagnostics Lab — fix each line to watch VibeLang diagnostics clear!

// 1. EK0909: write \`service Clock\` without \`class\`
service class Clock {
  now(): number!!
}

// 2. EK0101: insert \`function\` after \`effect\`
effect readTime() {
  const clock = try Clock
  return try clock.now()
}

// 3. EK3003: a service is a Context key, never instantiated with \`new\`
const bad = new Clock()

// 4. EK0501 / EK0502: \`try\` only runs inside an \`effect\` function or block
export function plainCaller() {
  return try Effect.succeed("move me into an effect function")
}
`,
    fallbackTs: `// Fix the diagnostics on the left to emit clean Effect TypeScript!`,
    fallbackJs: `export function plainCaller() { return "Fix diagnostics to run"; }`,
    fallbackDts: `// Fix diagnostics to emit declarations`,
  },
]

export function getPresetById(id: string): PlaygroundPreset {
  return PLAYGROUND_PRESETS.find((p) => p.id === id) ?? PLAYGROUND_PRESETS[0]
}
