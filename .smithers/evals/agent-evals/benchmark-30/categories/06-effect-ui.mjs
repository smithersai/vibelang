export default [
  {
    id: "ui-01-counter-model-update",
    category: "effect-ui",
    title: "Counter component: Schema Model, tagged Messages, exhaustive update & view",
    prompt: "Define schema CounterModel { count: number } and data CounterMsg { Inc; Dec; Reset }. Implement pure exhaustive update(model, msg) and view(model) returning string label. Apply [Inc, Inc, Dec, Reset, Inc] from count=0 and return { count: 1, view: 'Count: 1' }.",
    features: ["schema", "data", "match"],
    expectedOutput: { count: 1, view: "Count: 1" },
    vibe: `schema CounterModel {
  readonly count: number
}

data CounterMsg {
  Inc
  Dec
  Reset
}

function update(model: CounterModel, msg: CounterMsg): CounterModel {
  return match (msg) {
    when { _tag: "Inc" }: { count: model.count + 1 };
    when { _tag: "Dec" }: { count: model.count - 1 };
    when { _tag: "Reset" }: { count: 0 };
  }
}

function view(model: CounterModel): string {
  return \`Count: \${model.count}\`
}

export effect function run() {
  const msgs: CounterMsg[] = [
    CounterMsg.Inc(),
    CounterMsg.Inc(),
    CounterMsg.Dec(),
    CounterMsg.Reset(),
    CounterMsg.Inc(),
  ]
  let model: CounterModel = { count: 0 }
  for (const m of msgs) model = update(model, m)
  return { count: model.count, view: view(model) }
}
`,
    effectTs: `import { Data, Effect, Schema } from "effect"

const CounterModelSchema = Schema.Struct({ count: Schema.Number })
type CounterModel = typeof CounterModelSchema.Type

type CounterMsg = Data.TaggedEnum<{
  Inc: {}
  Dec: {}
  Reset: {}
}>
const CounterMsg = Data.taggedEnum<CounterMsg>()

function update(model: CounterModel, msg: CounterMsg): CounterModel {
  switch (msg._tag) {
    case "Inc": return { count: model.count + 1 }
    case "Dec": return { count: model.count - 1 }
    case "Reset": return { count: 0 }
  }
}

function view(model: CounterModel): string {
  return \`Count: \${model.count}\`
}

export const run = () =>
  Effect.sync(() => {
    const msgs: CounterMsg[] = [
      CounterMsg.Inc(),
      CounterMsg.Inc(),
      CounterMsg.Dec(),
      CounterMsg.Reset(),
      CounterMsg.Inc(),
    ]
    let model: CounterModel = { count: 0 }
    for (const m of msgs) model = update(model, m)
    return { count: model.count, view: view(model) }
  })
`,
    fault: {
      description: "Non-exhaustive match on CounterMsg omits Reset variant without default",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `data CounterMsg {
  Inc
  Dec
  Reset
}

function update(count: number, msg: CounterMsg): number {
  return match (msg) {
    when { _tag: "Inc" }: count + 1;
    when { _tag: "Dec" }: count - 1;
  }
}

export effect function run() {
  return update(0, CounterMsg.Inc())
}
`,
    },
  },
  {
    id: "ui-02-async-command-transition",
    category: "effect-ui",
    title: "Effect UI Command execution updating algebraic LoadState",
    prompt: "Model search state with data LoadState { Idle; Loading { query: string }; Ready { items: readonly string[] }; Errored { message: string } }. Dispatch a Search command that runs an Effect and emits Loaded or Failed messages, returning transitions ['Idle', 'Loading:vibe', 'Ready:2'].",
    features: ["data", "match", "effect function", "catch"],
    expectedOutput: { trace: ["Idle", "Loading:vibe", "Ready:2"] },
    vibe: `data LoadState {
  Idle
  Loading { query: string }
  Ready { items: readonly string[] }
  Errored { message: string }
}

data SearchMsg {
  QuerySubmitted { query: string }
  Loaded { items: readonly string[] }
  Failed { message: string }
}

error SearchFailed { reason: string }

effect function runSearch(query: string): readonly string[]!SearchFailed {
  if (query === "") throw new SearchFailed({ reason: "empty" })
  return [\`\${query}-core\`, \`\${query}-ui\`]
}

function update(state: LoadState, msg: SearchMsg): LoadState {
  return match (msg) {
    when { _tag: "QuerySubmitted", let query }: LoadState.Loading({ query });
    when { _tag: "Loaded", let items }: LoadState.Ready({ items });
    when { _tag: "Failed", let message }: LoadState.Errored({ message });
  }
}

function render(state: LoadState): string {
  return match (state) {
    when { _tag: "Idle" }: "Idle";
    when { _tag: "Loading", let query }: \`Loading:\${query}\`;
    when { _tag: "Ready", let items }: \`Ready:\${items.length}\`;
    when { _tag: "Errored", let message }: \`Errored:\${message}\`;
  }
}

export effect function run() {
  const trace: string[] = []
  let state: LoadState = LoadState.Idle()
  trace.push(render(state))
  state = update(state, SearchMsg.QuerySubmitted({ query: "vibe" }))
  trace.push(render(state))
  const nextMsg = (effect {
    const items = try runSearch("vibe")
    return SearchMsg.Loaded({ items }) as SearchMsg
  }) catch (e) => SearchMsg.Failed({ message: e.reason })
  state = update(state, nextMsg)
  trace.push(render(state))
  return { trace }
}
`,
    effectTs: `import { Data, Effect } from "effect"

type LoadState = Data.TaggedEnum<{
  Idle: {}
  Loading: { readonly query: string }
  Ready: { readonly items: readonly string[] }
  Errored: { readonly message: string }
}>
const LoadState = Data.taggedEnum<LoadState>()

type SearchMsg = Data.TaggedEnum<{
  QuerySubmitted: { readonly query: string }
  Loaded: { readonly items: readonly string[] }
  Failed: { readonly message: string }
}>
const SearchMsg = Data.taggedEnum<SearchMsg>()

class SearchFailed extends Data.TaggedError("SearchFailed")<{ readonly reason: string }> {}

const runSearch = (query: string): Effect.Effect<readonly string[], SearchFailed> =>
  query === "" ? Effect.fail(new SearchFailed({ reason: "empty" })) : Effect.succeed([\`\${query}-core\`, \`\${query}-ui\`])

function update(_state: LoadState, msg: SearchMsg): LoadState {
  switch (msg._tag) {
    case "QuerySubmitted": return LoadState.Loading({ query: msg.query })
    case "Loaded": return LoadState.Ready({ items: msg.items })
    case "Failed": return LoadState.Errored({ message: msg.message })
  }
}

function render(state: LoadState): string {
  switch (state._tag) {
    case "Idle": return "Idle"
    case "Loading": return \`Loading:\${state.query}\`
    case "Ready": return \`Ready:\${state.items.length}\`
    case "Errored": return \`Errored:\${state.message}\`
  }
}

export const run = () =>
  Effect.gen(function* () {
    const trace: string[] = []
    let state: LoadState = LoadState.Idle()
    trace.push(render(state))
    state = update(state, SearchMsg.QuerySubmitted({ query: "vibe" }))
    trace.push(render(state))
    const nextMsg: SearchMsg = yield* runSearch("vibe").pipe(
      Effect.map((items): SearchMsg => SearchMsg.Loaded({ items })),
      Effect.catch((e) => Effect.succeed<SearchMsg>(SearchMsg.Failed({ message: e.reason })))
    )
    state = update(state, nextMsg)
    trace.push(render(state))
    return { trace }
  })
`,
    fault: {
      description: "Leaves state stuck in Loading instead of transitioning to Ready when Loaded arrives",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  return { trace: ["Idle", "Loading:vibe", "Loading:vibe"] }
}
`,
    },
  },
  {
    id: "ui-03-exhaustive-view-match",
    category: "effect-ui",
    title: "Exhaustive view matching over UploadStatus algebraic variants",
    prompt: "Define data UploadStatus { Queued; Uploading { pct: number }; Done { url: string }; Failed { reason: string } } and render all four states via exhaustive match into structured VNode badges.",
    features: ["data", "match"],
    expectedOutput: [
      { tag: "span", tone: "neutral", text: "Queued" },
      { tag: "progress", tone: "info", text: "65%" },
      { tag: "a", tone: "success", text: "/files/a.png" },
      { tag: "alert", tone: "danger", text: "timeout" },
    ],
    vibe: `data UploadStatus {
  Queued
  Uploading { pct: number }
  Done { url: string }
  Failed { reason: string }
}

type Badge = { readonly tag: string; readonly tone: string; readonly text: string }

function viewStatus(status: UploadStatus): Badge {
  return match (status) {
    when { _tag: "Queued" }: { tag: "span", tone: "neutral", text: "Queued" };
    when { _tag: "Uploading", let pct }: { tag: "progress", tone: "info", text: \`\${pct}%\` };
    when { _tag: "Done", let url }: { tag: "a", tone: "success", text: url };
    when { _tag: "Failed", let reason }: { tag: "alert", tone: "danger", text: reason };
  }
}

export effect function run() {
  const statuses: UploadStatus[] = [
    UploadStatus.Queued(),
    UploadStatus.Uploading({ pct: 65 }),
    UploadStatus.Done({ url: "/files/a.png" }),
    UploadStatus.Failed({ reason: "timeout" }),
  ]
  return statuses.map(viewStatus)
}
`,
    effectTs: `import { Data, Effect } from "effect"

type UploadStatus = Data.TaggedEnum<{
  Queued: {}
  Uploading: { readonly pct: number }
  Done: { readonly url: string }
  Failed: { readonly reason: string }
}>
const UploadStatus = Data.taggedEnum<UploadStatus>()

type Badge = { readonly tag: string; readonly tone: string; readonly text: string }

function viewStatus(status: UploadStatus): Badge {
  switch (status._tag) {
    case "Queued": return { tag: "span", tone: "neutral", text: "Queued" }
    case "Uploading": return { tag: "progress", tone: "info", text: \`\${status.pct}%\` }
    case "Done": return { tag: "a", tone: "success", text: status.url }
    case "Failed": return { tag: "alert", tone: "danger", text: status.reason }
  }
}

export const run = () =>
  Effect.sync(() => {
    const statuses: UploadStatus[] = [
      UploadStatus.Queued(),
      UploadStatus.Uploading({ pct: 65 }),
      UploadStatus.Done({ url: "/files/a.png" }),
      UploadStatus.Failed({ reason: "timeout" }),
    ]
    return statuses.map(viewStatus)
  })
`,
    fault: {
      description: "View match forgets the Failed variant without a default arm",
      kind: "compile-error",
      expectedPattern: "EK",
      vibe: `data UploadStatus {
  Queued
  Uploading { pct: number }
  Done { url: string }
  Failed { reason: string }
}

function viewStatus(status: UploadStatus): string {
  return match (status) {
    when { _tag: "Queued" }: "Queued";
    when { _tag: "Uploading", let pct }: \`\${pct}%\`;
    when { _tag: "Done", let url }: url;
  }
}

export effect function run() {
  return viewStatus(UploadStatus.Queued())
}
`,
    },
  },
  {
    id: "ui-04-command-service-di",
    category: "effect-ui",
    title: "Testable UI Command injecting a service via provide",
    prompt: "Declare service SubmitApi { submit(name: string): string!ValidationErr }. Build a submitCommand(name) effect returning Submitted or Rejected UI messages, and test both outcomes by providing mock layers.",
    features: ["service", "error", "data", "provide", "catch"],
    expectedOutput: {
      okMsg: { _tag: "Submitted", receipt: "rcpt:ada" },
      errMsg: { _tag: "Rejected", field: "name" },
    },
    vibe: `error ValidationErr { field: string }

service SubmitApi {
  submit(name: string): string!ValidationErr
}

data FormMsg {
  Submitted { receipt: string }
  Rejected { field: string }
}

effect function submitCommand(name: string): FormMsg!!SubmitApi {
  const api = try SubmitApi
  return (effect {
    const receipt = try api.submit(name)
    return FormMsg.Submitted({ receipt }) as FormMsg
  }) catch (e) => FormMsg.Rejected({ field: e.field })
}

export effect function run() {
  const mockApi = Layer.succeed(SubmitApi, {
    submit: effect (name: string) => {
      if (name.length === 0) throw new ValidationErr({ field: "name" })
      return \`rcpt:\${name}\`
    },
  })
  provide mockApi {
    const okMsg = try submitCommand("ada")
    const errMsg = try submitCommand("")
    return { okMsg, errMsg }
  }
}
`,
    effectTs: `import { Context, Data, Effect, Layer } from "effect"

class ValidationErr extends Data.TaggedError("ValidationErr")<{ readonly field: string }> {}

class SubmitApi extends Context.Service<SubmitApi, {
  submit(name: string): Effect.Effect<string, ValidationErr>
}>()("eval/SubmitApi") {}

type FormMsg = Data.TaggedEnum<{
  Submitted: { readonly receipt: string }
  Rejected: { readonly field: string }
}>
const FormMsg = Data.taggedEnum<FormMsg>()

const submitCommand = (name: string): Effect.Effect<FormMsg, never, SubmitApi> =>
  Effect.gen(function* () {
    const api = yield* SubmitApi
    return yield* api.submit(name).pipe(
      Effect.map((receipt): FormMsg => FormMsg.Submitted({ receipt })),
      Effect.catch((e) => Effect.succeed<FormMsg>(FormMsg.Rejected({ field: e.field })))
    )
  })

export const run = () => {
  const mockApi = Layer.succeed(SubmitApi, {
    submit: (name: string) =>
      name.length === 0 ? Effect.fail(new ValidationErr({ field: "name" })) : Effect.succeed(\`rcpt:\${name}\`),
  })
  return Effect.gen(function* () {
    const okMsg = yield* submitCommand("ada")
    const errMsg = yield* submitCommand("")
    return { okMsg, errMsg }
  }).pipe(Effect.provide(mockApi))
}
`,
    fault: {
      description: "Instantiates service SubmitApi with new instead of reading it via try (EK3003)",
      kind: "compile-error",
      expectedPattern: "EK3003",
      vibe: `service SubmitApi {
  submit(name: string): string!!
}

export effect function run() {
  return new SubmitApi()
}
`,
    },
  },
  {
    id: "ui-05-story-replay-test",
    category: "effect-ui",
    title: "Deterministic Effect UI Story replay for Todo list interactions",
    prompt: "Implement a Todo Story replay over [Add('write'), Add('ship'), Toggle('write'), SetFilter('active'), ClearCompleted] producing snapshots of visible titles at each step and final remaining count.",
    features: ["data", "match", "schema"],
    expectedOutput: {
      visibleAfterFilter: ["ship"],
      remainingTitles: ["ship"],
      totalRemaining: 1,
    },
    vibe: `schema TodoItem {
  readonly title: string
  readonly done: boolean
}

schema TodoModel {
  readonly items: readonly TodoItem[]
  readonly filter: "all" | "active"
}

data TodoMsg {
  Add { title: string }
  Toggle { title: string }
  SetFilter { filter: "all" | "active" }
  ClearCompleted
}

function update(model: TodoModel, msg: TodoMsg): TodoModel {
  return match (msg) {
    when { _tag: "Add", let title }: {
      ...model,
      items: [...model.items, { title, done: false }],
    };
    when { _tag: "Toggle", let title }: {
      ...model,
      items: model.items.map((it) => it.title === title ? { ...it, done: !it.done } : it),
    };
    when { _tag: "SetFilter", let filter }: { ...model, filter };
    when { _tag: "ClearCompleted" }: {
      ...model,
      items: model.items.filter((it) => !it.done),
    };
  }
}

function visibleTitles(model: TodoModel): string[] {
  return model.items
    .filter((it) => model.filter === "all" || !it.done)
    .map((it) => it.title)
}

export effect function run() {
  let model: TodoModel = { items: [], filter: "all" }
  model = update(model, TodoMsg.Add({ title: "write" }))
  model = update(model, TodoMsg.Add({ title: "ship" }))
  model = update(model, TodoMsg.Toggle({ title: "write" }))
  model = update(model, TodoMsg.SetFilter({ filter: "active" }))
  const visibleAfterFilter = visibleTitles(model)
  model = update(model, TodoMsg.ClearCompleted())
  const remainingTitles = model.items.map((it) => it.title)
  return { visibleAfterFilter, remainingTitles, totalRemaining: model.items.length }
}
`,
    effectTs: `import { Data, Effect } from "effect"

interface TodoItem {
  readonly title: string
  readonly done: boolean
}

interface TodoModel {
  readonly items: readonly TodoItem[]
  readonly filter: "all" | "active"
}

type TodoMsg = Data.TaggedEnum<{
  Add: { readonly title: string }
  Toggle: { readonly title: string }
  SetFilter: { readonly filter: "all" | "active" }
  ClearCompleted: {}
}>
const TodoMsg = Data.taggedEnum<TodoMsg>()

function update(model: TodoModel, msg: TodoMsg): TodoModel {
  switch (msg._tag) {
    case "Add":
      return { ...model, items: [...model.items, { title: msg.title, done: false }] }
    case "Toggle":
      return { ...model, items: model.items.map((it) => (it.title === msg.title ? { ...it, done: !it.done } : it)) }
    case "SetFilter":
      return { ...model, filter: msg.filter }
    case "ClearCompleted":
      return { ...model, items: model.items.filter((it) => !it.done) }
  }
}

function visibleTitles(model: TodoModel): string[] {
  return model.items
    .filter((it) => model.filter === "all" || !it.done)
    .map((it) => it.title)
}

export const run = () =>
  Effect.sync(() => {
    let model: TodoModel = { items: [], filter: "all" }
    model = update(model, TodoMsg.Add({ title: "write" }))
    model = update(model, TodoMsg.Add({ title: "ship" }))
    model = update(model, TodoMsg.Toggle({ title: "write" }))
    model = update(model, TodoMsg.SetFilter({ filter: "active" }))
    const visibleAfterFilter = visibleTitles(model)
    model = update(model, TodoMsg.ClearCompleted())
    const remainingTitles = model.items.map((it) => it.title)
    return { visibleAfterFilter, remainingTitles, totalRemaining: model.items.length }
  })
`,
    fault: {
      description: "ClearCompleted keeps completed items and drops active items (inverted predicate)",
      kind: "runtime-fail",
      vibe: `export effect function run() {
  return { visibleAfterFilter: ["ship"], remainingTitles: ["write"], totalRemaining: 1 }
}
`,
    },
  },
]
