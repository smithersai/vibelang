import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("root package preserves the JavaScript TypeScript API by identity", () => {
  const smithers = require("smthrs");
  const ts = require("typescript-js");

  assert.equal(smithers, ts);
  assert.equal(smithers.createProgram, ts.createProgram);
  assert.equal(smithers.createLanguageService, ts.createLanguageService);
  assert.equal(smithers.factory, ts.factory);
  assert.equal(smithers.server, ts.server);
  assert.deepEqual(Object.keys(smithers), Object.keys(ts));
});

test("ES modules receive TypeScript named exports", async () => {
  const smithers = await import("smthrs");
  assert.equal(typeof smithers.createProgram, "function");
  assert.equal(typeof smithers.createLanguageService, "function");
  assert.equal(typeof smithers.default.createProgram, "function");
});

test("historical tsserverlibrary subpath is compatible", () => {
  const smithersServer = require("smthrs/tsserverlibrary");
  const tsServer = require("typescript-js/lib/tsserverlibrary.js");
  assert.equal(smithersServer, tsServer);
  assert.equal(smithersServer.server, tsServer.server);
});

test("common TypeScript compatibility aliases resolve", () => {
  const root = require("smthrs");
  assert.equal(require("smthrs/typescript"), root);
  assert.equal(require("smthrs/lib/typescript"), root);
  assert.equal(require("smthrs/lib/typescript.js"), root);
  assert.equal(require("smthrs/lib/tsserverlibrary.js").server, root.server);
});

test("plugin implements a pass-through PluginModuleFactory", () => {
  const init = require("smthrs/plugin");
  const ts = require("typescript-js");
  const languageService = {
    dispose() {},
    getProgram() { return undefined; },
  };
  const messages = [];
  const plugin = init({ typescript: ts });
  const proxy = plugin.create({
    languageService,
    project: { projectService: { logger: { info: (value) => messages.push(value) } } },
  });

  assert.notEqual(proxy, languageService);
  assert.equal(proxy.getProgram(), undefined);
  assert.deepEqual(plugin.getExternalFiles({}), []);
  assert.equal(messages.length, 1);
});

test("Smithers-specific API delegates TypeScript and rejects .sm honestly", async () => {
  const api = await import("smthrs/smithers");
  const program = api.createProgram([], {});
  assert.equal(typeof program.getTypeChecker, "function");
  assert.throws(
    () => api.createProgram(["main.sm"], {}),
    (error) => error?.code === "SMITHERS_NOT_IMPLEMENTED",
  );
});

test("TypeScript 7 unstable AST wrapper is live", async () => {
  const ast = await import("smthrs/unstable/ast");
  assert.equal(typeof ast.createScanner, "function");
  assert.equal(typeof ast.SyntaxKind.Identifier, "number");
});
