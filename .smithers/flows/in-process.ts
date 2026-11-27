// Ephemeral in-memory wrapper over `./host.ts`. A flow's eval grades it this
// way, and deterministic tests run with it when they want zero `.flows/` state.
// Durable runs go through `./host.ts` (default) or `smthrs flow start <flow>`,
// both of which record runs in `.flows/` where `smthrs runs list` reads them.
import type { Layer } from "effect";
import { execute as hostExecute, memoryRuntime, type RunnableFlow } from "./host.ts";

/** runtime composes a flow, its implementations and the in-memory engine. */
export const runtime = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
) => memoryRuntime(flow, implementations);

/** execute runs one execution of a flow in-memory and returns its exit. */
export const execute = <P, A, E, ROut, RErr, RIn>(
  flow: RunnableFlow<P, A, E>,
  implementations: Layer.Layer<ROut, RErr, RIn>,
  payload: P,
  executionId?: string,
) => hostExecute(flow, implementations, payload, { memory: true, executionId });
