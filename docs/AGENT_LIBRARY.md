# Coding agent library

Status: **Direction**. This is the target coding-agent library contract and does
not add language syntax. Package names, exact API spellings, journal format,
sandbox provider, and model-provider adapters remain open.

## Decision

Smithers's default coding agent writes ordinary TypeScript on every turn. The
generated program runs in a sandbox and receives only an explicit table of
callable functions. It has no ambient filesystem, network, process,
environment, module loader, tools, or MCP access.

Actions and Flows are the common callable boundary:

```text
tool or MCP operation -> typed Action -> generated-code function
durable(...) Flow     -> typed high-level function
```

An MCP protocol and a tool-calling protocol are adapters, not separate agent
semantics. The agent loop and sandbox belong to a library/runtime, not to the
Smithers grammar or type system.

## Candidate API

```ts
import { CodingAgent, TypeScriptSandbox } from "@smithers/agent"
import CodingPrompt from "./coding-agent.mdx" with { type: "mdx" }

const Coder = CodingAgent.make({
  model,
  prompt: CodingPrompt,
  sandbox: TypeScriptSandbox.make({
    timeout: "30s",
    memory: "512mb"
  }),
  functions: {
    readFile: ReadFile,       // Action
    editFile: EditFile,       // Action
    callGitHub: GitHubCall,   // MCP operation adapted to an Action
    build: Build              // Flow emitted by durable(...)
  }
})

const result = (await Coder.run({ task }))!
```

The generated source has one entry point and one authority-bearing argument:

```ts
export default async function turn(functions: Functions) {
  const source = (await functions.readFile({ path: "src/index.ts" }))!
  return functions.build({ source })
}
```

`Functions` is generated from the supplied callback, Action, and Flow
signatures. In a durable or remote composition, Action and Flow members may be
RPC proxies into the durable executor; a local composition may use ordinary
closures. Only Action and Flow calls receive durable execution semantics.

This explicit argument is the authority boundary for untrusted generated
TypeScript, not Smithers's capability mechanism. Authored Smithers functions
obtain capabilities through the inherited `Capability.context()` method from
`smthrs/context`, and those requirements appear in the function's static
type without adding a source parameter. The sandbox passes `functions`
deliberately because generated code is otherwise denied ambient authority.

## MDX prompts

The agent package supplies an ordinary typed MDX component vocabulary. The
compiler only loads the MDX module; the library decides how components become
model messages and provider-specific payloads.

```mdx
<System>You are a coding agent.</System>
<Context><File path="README.md" /></Context>
<Task>{task}</Task>
```

Applications can replace components or render the same prompt for another
model API without compiler support.

The MDX component named `Context` is prompt markup supplied by the agent
library. It is unrelated to the `Context` capability base class in
`smthrs/context`.

## Turn lifecycle

The library:

1. renders the prompt, including MDX components supplied by the agent package;
2. invokes the model and extracts ordinary TypeScript source;
3. type-checks that source against the generated `Functions` declaration;
4. optionally feeds diagnostics back to the model;
5. bundles and runs accepted code in the configured sandbox;
6. exposes only the supplied function proxies; and
7. returns the typed result, diagnostics, logs, and generated-source artifact.

The sandbox is the security boundary. Omitting Node/DOM declarations from the
generated program's TypeScript configuration improves diagnostics, but the
type checker is not relied upon for confinement.

## Optional durable behavior

The agent remains usable as a normal library without the durable runtime. When
the durable adapter is installed, the model request, accepted source artifact,
sandbox execution, and every Action or Flow call become journaled boundaries.
Consequently:

- replay reuses the recorded model response and completed calls instead of
  asking the model or repeating side effects;
- generated source and compiler diagnostics are content-addressed artifacts;
- Action retries, idempotency, caching, placement, and compensation retain
  their normal semantics when called by generated code;
- a passed Flow starts or joins a durable execution using its normal runtime
  contract; and
- logs, stdout/stderr, defects, cancellation, and resource-limit termination
  are attached to the turn's execution history.

The execution journal always reuses the model response when replaying the same
turn. Optional reuse across otherwise separate turns or executions is
nondeterministic Action memoization: the first committed response for the
explicit memo key, scope, and generation atomically becomes canonical. Typed
failures do not poison that memo by default. It is not a sealed content-cache
claim that invoking the model again would reproduce the same text.

Generated code is not silently wrapped in `durable(...)` or converted into a Flow. It is ordinary
runtime TypeScript. Under the durable adapter, proxy calls are child
invocations with stable identities derived from the turn execution,
accepted-source digest, call site, and per-site ordinal. Restarting the turn
returns already-recorded call results. Ambient clock, random, network, and
filesystem access remain absent; nondeterminism must enter through a passed
function, normally an Action when it must be replayable.

### Flow adapter

`flowTool(target, options)` illustrates a callable adapter projected from a
validated compiled Plan. It derives an execution identity from the turn,
accepted-source digest, exposed function and call site, Flow and Plan identity,
and input digest, then commits that attachment before starting work. Replay
joins the same execution and reuses committed Action results. A different input
or Plan fails as journal divergence instead of mutating the pinned execution.

The agent journal and durable store MUST define crash-safe attachment semantics
even when they cannot share one storage transaction. Deployment-envelope
verification, remote coordinator handoff, principal authorization, and stable
identity for data-dependent call sites remain open.

The journal must record the model/provider version, prompt digest, callable
surface digest, generated-source digest, compiler version, sandbox image, and
Action/Flow deployment manifest. Secrets and sensitive payload fields follow
the normal redaction policy.

## Compiler responsibilities

No agent-specific compiler mode is required. The compiler must only provide
general facilities also useful elsewhere:

- compile and type-check ordinary TypeScript from virtual or in-memory files;
- accept a generated declaration for the callable surface;
- emit diagnostics, source maps, and a runnable TypeScript bundle or bytecode;
- expose compiler and output digests for incremental caching; and
- expose the already-derived Action/Flow signatures and durable codecs.

Import resolution, available library declarations, and bundling are ordinary
compiler-host configuration supplied by the agent library. They are not new
syntax.

## Library/runtime responsibilities

`@smithers/agent` owns prompt rendering, the code-writing loop, diagnostic
repair, model adapters, MCP/tool adapters, sandbox creation, resource limits,
function-proxy transport, durable turn orchestration, logging, redaction, and
policy. The Smithers library contract supports generated TypeScript. Other
source languages or agent strategies may use the same Action and Flow boundary
without changing Smithers.

The library should expose independently replaceable primitives for prompt
rendering, model invocation/streaming, turn state, TypeScript extraction and
diagnostics, sandbox creation, passed-function binding, execution observations,
continuation/stopping, and optional durability. A custom agent should compose
these pieces rather than reimplement a hidden monolithic loop.

## Open library decisions

1. Prompt component vocabulary and provider-renderer boundary.
2. Generated-program completion/result protocol.
3. Sandbox backend interface and default resource limits.
4. How diagnostics and runtime observations enter the next turn.
5. Stable child-call identity when accepted code contains data-dependent loops.
