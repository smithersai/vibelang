// Runs a flow inside this process on the in-memory engine. A flow's eval grades
// it this way, and the docs generator renders with it: both want no state
// behind them. Everything else runs a flow on the durable host,
// `smthrs flow start <flow> --data '<payload>'`, which records the run in
// `.flows/`, where `smthrs runs list` and `smthrs runs show` read it.
import { Effect, Layer } from "effect";
import * as Crypto from "effect/Crypto";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import { syncCrypto } from "@smthrs/crypto";

type Flow<P, A, E> = Parameters<typeof Interpreter.layerWithImplementations>[0] & {
  readonly _tag: string;
  readonly execute: (payload: P, options: { readonly executionId: string }) => Effect.Effect<A, E, any>;
};

/** runtime composes a flow, its implementations and the in-memory engine. */
export const runtime = <P, A, E>(flow: Flow<P, A, E>, implementations: Layer.Layer<any, any, any>) =>
  Interpreter.layerWithImplementations(flow, implementations as never).pipe(
    Layer.provideMerge(FlowEngine.layerMemory),
    Layer.provideMerge(Layer.succeed(Crypto.Crypto, syncCrypto))
  );

/** execute runs one execution of a flow and returns its exit. */
export const execute = <P, A, E>(flow: Flow<P, A, E>, implementations: Layer.Layer<any, any, any>, payload: P,
  executionId = `${flow._tag}-${Date.now()}`) =>
  Effect.runPromiseExit(flow.execute(payload, { executionId }).pipe(Effect.provide(runtime(flow, implementations))) as Effect.Effect<A, E>);
