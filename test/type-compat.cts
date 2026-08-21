import ts = require("vibelang");
import tsAlias = require("vibelang/typescript");
import initPlugin = require("vibelang/plugin");
import * as native from "vibelang/unstable/sync";
import * as ast from "vibelang/unstable/ast";
import { createPassThroughLanguageService } from "vibelang/language-service";
import { NotImplementedError, createProgram } from "vibelang/vibe";
import { Action, Layer, type Durable } from "vibelang/provider";
import { Context } from "vibelang/context";
import { Result, type UnhandledException } from "vibelang/result";
import { Optional } from "vibelang/optional";

const options: ts.CompilerOptions = { strict: true, noEmit: true };
const program: ts.Program = createProgram([], options);
const checker: ts.TypeChecker = program.getTypeChecker();
const factory: ts.server.PluginModuleFactory = initPlugin;
const nativeApi: typeof native.API = native.API;
const identifierKind: ast.SyntaxKind = ast.SyntaxKind.Identifier;
const sameFactory: typeof ts.factory = tsAlias.factory;

abstract class Work extends Action<(input: string) => number> {}
abstract class Clock extends Context {
  abstract now(): Date;
}
class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
declare const workLayer: Layer<Work, never, never>;
declare const codec: Durable<{ value: string }>;
const clock: Clock = Clock.context();
const clockLayer: Layer<Clock> = Layer.succeed(Clock, new SystemClock());
declare const fallible: Result<number, UnhandledException>;
declare const optional: Optional<number>;
const recovered: number = fallible.unwrapOr(0);
const defaulted: number = optional.unwrapOr(0);

void checker;
void factory;
void nativeApi;
void identifierKind;
void sameFactory;
void workLayer;
void codec;
void clock;
void clockLayer;
void recovered;
void defaulted;
void NotImplementedError;
void createPassThroughLanguageService;
