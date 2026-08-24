import ts = require("smthrs");
import tsAlias = require("smthrs/typescript");
import initPlugin = require("smthrs/plugin");
import * as native from "smthrs/unstable/sync";
import * as ast from "smthrs/unstable/ast";
import { createPassThroughLanguageService } from "smthrs/language-service";
import { NotImplementedError, createProgram } from "smthrs/smithers";
import { Action, Layer, type Durable } from "smthrs/provider";
import { Context } from "smthrs/context";
import { Result, type UnhandledException } from "smthrs/result";

const options: ts.CompilerOptions = { strict: true, noEmit: true };
const program: ts.Program = createProgram([], options);
const checker: ts.TypeChecker = program.getTypeChecker();
const factory: ts.server.PluginModuleFactory = initPlugin;
const nativeApi: typeof native.API = native.API;
const identifierKind: ast.SyntaxKind = ast.SyntaxKind.Identifier;
const sameFactory: typeof ts.factory = tsAlias.factory;

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
// @ts-expect-error CompilerOptions.strict is a boolean, not a string
const looseOptions: ts.CompilerOptions = { strict: "yes" };
// @ts-expect-error the program keeps its structured checker type
const wrongChecker: string = program.getTypeChecker();
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
// @ts-expect-error SyntaxKind is an enum, not arbitrary strings
const wrongKind: ast.SyntaxKind = "Identifier";

void checker;
void factory;
void nativeApi;
void identifierKind;
void sameFactory;
void workLayer;
void mergedLayer;
void codec;
void clock;
void clockLayer;
void recovered;
void defaulted;
void NotImplementedError;
void createPassThroughLanguageService;
void looseOptions;
void wrongChecker;
void wrongLayer;
void wrongProvide;
void wrongRecovered;
void wrongDefaulted;
void wrongAbsent;
void chained;
void wrongKind;
