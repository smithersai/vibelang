import type { NativeCompiler, NativeCompileRequest, NativeCompileResult, NativeTokenResult } from "vibelang";
import { Action, Layer, type Durable } from "vibelang/provider";
import { Context } from "vibelang/context";
import { Result, type UnhandledException } from "vibelang/result";

declare const compiler: NativeCompiler;
const request: NativeCompileRequest = { rootNames:["main.vibe"], files:[{path:"main.vibe",kind:"vibelang",text:"export const value=1;"}], lowering:"internal" };
const compiled: NativeCompileResult = compiler.compile(request);
const root: Promise<typeof import("vibelang/compiler")> = import("vibelang");
const token: NativeTokenResult = compiler.tokenAt({ text: "value", offset: 2 });

abstract class Work extends Action<(input: string) => Result<number, never>> {}
abstract class Clock extends Context {
  abstract now(): Date;
}
class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
declare const workLayer: Layer<Work>;
// @ts-expect-error base Layer carries only its provided environment
type LegacyConstructionLayer = Layer<Work, never, never>;
declare const codec: Durable<{ value: string }>;
const clock: Clock = Clock.context();
const clockLayer: Layer<Clock> = Layer.succeed(Clock, new SystemClock());
const mergedLayer: Layer<Clock | Work> = Layer.merge(clockLayer, workLayer);
declare const fallible: Result<number, UnhandledException>;
// Absence is `T | undefined`: no container, and `??` is the reader.
declare const absent: number | undefined;
const recovered: number = fallible.unwrapOr(0);
const defaulted: number = absent ?? 0;
const chained: number | undefined = absent?.valueOf();

// Negative space: each line below is an error only while the public types stay
// strong. If a surface loosens to `any`, the suppression becomes unused and the
// compat gate fails with TS2578.
// @ts-expect-error the transport must not invent a fallback lowering mode
const looseOptions: NativeCompileRequest = { ...request, lowering: "legacy" };
// @ts-expect-error native compilation returns structured data, not a checker or string
const wrongChecker: string = compiler.compile(request);
// @ts-expect-error the old mutable compiler Program surface is deliberately absent
compiler.createProgram([], {});
// @ts-expect-error the implementation must satisfy the service contract
const wrongLayer: Layer<Clock> = Layer.succeed(Clock, { now: () => 42 });
// @ts-expect-error provide takes a callback body, not a plain value
const wrongProvide: number = Layer.provide(clockLayer, 42);
// @ts-expect-error unwrapOr on Result<number, _> cannot produce a string
const wrongRecovered: string = fallible.unwrapOr(0);
// @ts-expect-error `number | undefined` coalesced with a number is not a string
const wrongDefaulted: string = absent ?? 0;
// @ts-expect-error absence must be narrowed before it is used as a number
const wrongAbsent: number = absent;
// @ts-expect-error symbolic token kinds are native data, not legacy enum numbers
const wrongKind: number = token.token!.kind;
// @ts-expect-error the unpinned upstream JavaScript scanner is not our API
type UnpinnedScanner = typeof import("vibelang/unstable/ast/scanner");

void compiled;
void root;
void token;
void workLayer;
void mergedLayer;
void codec;
void clock;
void clockLayer;
void recovered;
void defaulted;
void looseOptions;
void wrongChecker;
void wrongLayer;
void wrongProvide;
void wrongRecovered;
void wrongDefaulted;
void wrongAbsent;
void chained;
void wrongKind;
