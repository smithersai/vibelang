import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("root package preserves the JavaScript TypeScript API by identity", () => {
  const vibe = require("vibelang");
  const ts = require("typescript-js");

  assert.equal(vibe, ts);
  assert.equal(vibe.createProgram, ts.createProgram);
  assert.equal(vibe.createLanguageService, ts.createLanguageService);
  assert.equal(vibe.factory, ts.factory);
  assert.equal(vibe.server, ts.server);
  assert.deepEqual(Object.keys(vibe), Object.keys(ts));
});

test("ES modules receive TypeScript named exports", async () => {
  const vibe = await import("vibelang");
  assert.equal(typeof vibe.createProgram, "function");
  assert.equal(typeof vibe.createLanguageService, "function");
  assert.equal(typeof vibe.default.createProgram, "function");
});

test("historical tsserverlibrary subpath is compatible", () => {
  const vibeServer = require("vibelang/tsserverlibrary");
  const tsServer = require("typescript-js/lib/tsserverlibrary.js");
  assert.equal(vibeServer, tsServer);
  assert.equal(vibeServer.server, tsServer.server);
});

test("common TypeScript compatibility aliases resolve", () => {
  const root = require("vibelang");
  assert.equal(require("vibelang/typescript"), root);
  assert.equal(require("vibelang/lib/typescript"), root);
  assert.equal(require("vibelang/lib/typescript.js"), root);
  assert.equal(require("vibelang/lib/tsserverlibrary.js").server, root.server);
});

test("plugin implements a pass-through PluginModuleFactory", () => {
  const init = require("vibelang/plugin");
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

test("Vibe-specific API delegates TypeScript and rejects .vibe honestly", async () => {
  const api = await import("vibelang/vibe");
  const program = api.createProgram([], {});
  assert.equal(typeof program.getTypeChecker, "function");
  assert.throws(
    () => api.createProgram(["main.vibe"], {}),
    (error) => error?.code === "VIBE_NOT_IMPLEMENTED",
  );
});

test("TypeScript 7 unstable AST wrapper is live", async () => {
  const ast = await import("vibelang/unstable/ast");
  assert.equal(typeof ast.createScanner, "function");
  assert.equal(typeof ast.SyntaxKind.Identifier, "number");
});
