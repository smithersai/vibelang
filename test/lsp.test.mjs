import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

/**
 * A minimal LSP client over a real `vibe lsp` subprocess: correctly framed
 * JSON-RPC 2.0 with `Content-Length` headers, exactly as an editor speaks it.
 */
class LspSession {
  #buffer = Buffer.alloc(0);
  #messages = [];
  #waiters = [];
  #nextId = 1;

  constructor(child) {
    this.child = child;
    this.stderr = "";
    child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#drain();
    });
    this.exited = new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve(signal === null ? code : `signal:${signal}`));
    });
  }

  #drain() {
    for (;;) {
      const separator = this.#buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const header = this.#buffer.subarray(0, separator).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      assert.ok(match, `server sent an unframed message: ${JSON.stringify(header)}`);
      const length = Number.parseInt(match[1], 10);
      const bodyStart = separator + 4;
      if (this.#buffer.length < bodyStart + length) return;
      const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      this.#messages.push(JSON.parse(body));
      for (const waiter of this.#waiters.splice(0)) waiter();
    }
  }

  raw(text) {
    this.child.stdin.write(text);
  }

  send(message) {
    const body = JSON.stringify(message);
    this.raw(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  request(method, params) {
    const id = this.#nextId++;
    this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    return id;
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async next(predicate, label) {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const index = this.#messages.findIndex(predicate);
      if (index >= 0) return this.#messages.splice(index, 1)[0];
      if (Date.now() > deadline) {
        throw new TypeError(`timed out waiting for ${label}; stderr was ${JSON.stringify(this.stderr)}`);
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 25);
        this.#waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  response(id) {
    return this.next((message) => message.id === id, `response ${id}`);
  }

  published(uri) {
    return this.next(
      (message) => message.method === "textDocument/publishDiagnostics" && message.params.uri === uri,
      `publishDiagnostics for ${uri}`,
    );
  }
}

const FAILING = [
  "class NotFound extends Error {",
  "  constructor(readonly id: number) { super(`missing ${id}`) }",
  "}",
  "",
  "export function findUser(id: number) {",
  "  if (id < 0) throw new NotFound(id)",
  "  return id",
  "}",
  "",
].join("\n");

const PASSING = FAILING.replace(
  "export function findUser(id: number) {",
  "export function findUser(id: number): Result<number, NotFound> {",
);

function startServer() {
  const child = spawn(process.execPath, ["bin/vibe.js", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new LspSession(child);
}

async function withServer(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-lsp-")));
  const session = startServer();
  try {
    return await body(session, root);
  } finally {
    if (session.child.exitCode === null) session.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
}

async function initialize(session, root) {
  const uri = pathToFileURL(root).href;
  const response = await session.response(session.request("initialize", {
    processId: null,
    rootUri: uri,
    capabilities: {},
    workspaceFolders: [{ uri, name: "workspace" }],
  }));
  session.notify("initialized", {});
  return response;
}

function open(session, path, text, version = 1) {
  session.notify("textDocument/didOpen", {
    textDocument: { uri: pathToFileURL(path).href, languageId: "vibelang", version, text },
  });
}

test("vibe lsp completes the initialize handshake over stdio", async () => {
  await withServer(async (session, root) => {
    const response = await initialize(session, root);
    assert.equal(response.error, undefined);
    assert.deepEqual(response.result.capabilities, {
      positionEncoding: "utf-16",
      textDocumentSync: { openClose: true, change: 1, save: false },
      hoverProvider: true,
      definitionProvider: true,
      documentFormattingProvider: true,
    });
    assert.equal(response.result.serverInfo.name, "vibelang-lsp");

    const shutdown = await session.response(session.request("shutdown"));
    assert.equal(shutdown.result, null);
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("vibe lsp publishes the exact frontend diagnostic and range, and updates it on change", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const file = join(root, "failing.vibe");
    writeFileSync(file, FAILING);
    const uri = pathToFileURL(file).href;

    open(session, file, FAILING);
    const first = await session.published(uri);
    assert.deepEqual(first.params.diagnostics, [{
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
      severity: 1,
      code: "VIBE1102",
      source: "vibelang",
      message: "exported fallible functions must spell Result<A, E> (or Promise<Result<A, E>>) in their public contract",
    }]);

    session.notify("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: PASSING }],
    });
    const second = await session.published(uri);
    assert.deepEqual(second.params.diagnostics, []);
    assert.equal(second.params.version, 2);

    session.notify("textDocument/didChange", {
      textDocument: { uri, version: 3 },
      contentChanges: [{ text: FAILING }],
    });
    const third = await session.published(uri);
    assert.deepEqual(third.params.diagnostics.map((entry) => entry.code), ["VIBE1102"]);

    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("vibe lsp hover shows the checked channel and inferred rows", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const file = join(root, "domain.vibe");
    const source = [
      "export class Missing extends Error {",
      "  constructor(readonly key: string) { super(`missing ${key}`) }",
      "}",
      "",
      "export function lookup(key: string): Result<string, Missing> {",
      "  if (key === \"\") throw new Missing(key)",
      "  return key",
      "}",
      "",
    ].join("\n");
    writeFileSync(file, source);
    open(session, file, source);

    const hover = await session.response(session.request("textDocument/hover", {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line: 4, character: 20 },
    }));
    assert.equal(hover.result.contents.kind, "markdown");
    assert.equal(
      hover.result.contents.value,
      [
        "```vibelang",
        "export function lookup(key: string): Result<string, Missing>",
        "```",
        "",
        "**channel** `Result`",
        "",
        "**failures** `Missing`",
        "",
        "**requirements** _none_",
      ].join("\n"),
    );

    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("the shipped editor and CLI agree on executable Flow buffers and mapped refusals", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const file = join(root, "flow.vibe");
    const uri = pathToFileURL(file).href;
    const valid = `import { comptime } from "vibelang:comptime"
import { Action, durable } from "vibelang:flows"
const seed = comptime({ first: 1, second: 2 })
abstract class Read extends Action<(n: number) => Result<number, never>> {}
function helper(n: number): Result<number, never> { return Read.run(n)! }
export const Flow = durable((n: number): Result<number, never> => helper(n + seed.second)!)
export function name(): string { return Flow.manifest.flowId }
`;
    const invalid = `import { comptime } from "vibelang:comptime"
import { durable } from "vibelang:flows"
const seed = comptime({ first: 1, second: 2 })
export function make() {
  const Flow = durable((n: number) => n + seed.second)
  return Flow
}
`;
    for (const [index, source] of [valid, invalid, valid].entries()) {
      writeFileSync(file, source);
      const cli = spawnSync(process.execPath, ["bin/vibe.js", "check", file, "--format", "json"], {
        encoding: "utf8", timeout: 60_000,
      });
      assert.equal(cli.status, index === 1 ? 1 : 0, cli.stderr || cli.stdout);
      const expected = JSON.parse(cli.stdout).files.flatMap(f => f.diagnostics).map(d => ({
        code: d.code, line: d.line - 1, character: d.column - 1,
      }));
      assert.deepEqual(expected, index === 1 ? [{ code: "VIBE4103", line: 4, character: 15 }] : []);
      // The disk now disagrees: every stage must read the open buffer.
      writeFileSync(file, index === 1 ? valid : invalid);
      if (index === 0) open(session, file, source);
      else session.notify("textDocument/didChange", {
        textDocument: { uri, version: index + 1 }, contentChanges: [{ text: source }],
      });
      const published = await session.published(uri);
      assert.equal(published.params.version, index + 1);
      assert.deepEqual(published.params.diagnostics.map(d => ({ code: d.code, ...d.range.start })), expected);
    }
    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("vibe lsp uses native module literal spans through escapes, attributes and buffer changes", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const app=join(root,"links.vibe"),a=join(root,"a.vibe"),b=join(root,"b.vibe");
    writeFileSync(a,"export const value = 1;");
    writeFileSync(b,"export const value = 2;");
    const uri=pathToFileURL(app).href;
    const source='/*😀*/ import {value} from "./\\u0061.vibe" with {type:"json"};';
    writeFileSync(app,source);
    open(session,app,source);
    const definition=await session.response(session.request("textDocument/definition",{textDocument:{uri},position:{line:0,character:source.indexOf('"./')+3}}));
    assert.deepEqual(definition.result,{uri:pathToFileURL(a).href,range:{start:{line:0,character:0},end:{line:0,character:0}}});
    const attribute=await session.response(session.request("textDocument/definition",{textDocument:{uri},position:{line:0,character:source.indexOf('"json"')+2}}));
    assert.equal(attribute.result,null);
    const changed='export * from "./b.vibe";';
    session.notify("textDocument/didChange",{textDocument:{uri,version:2},contentChanges:[{text:changed}]});
    const next=await session.response(session.request("textDocument/definition",{textDocument:{uri},position:{line:0,character:changed.indexOf('"./')+3}}));
    assert.equal(next.result.uri,pathToFileURL(b).href);
    assert.deepEqual(next.result.range,{start:{line:0,character:0},end:{line:0,character:0}});
    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited,0);
  });
});

test("vibe lsp resolves definitions and formats documents", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const domain = join(root, "domain.vibe");
    const app = join(root, "app.vibe");
    const domainSource = [
      "export class Missing extends Error {",
      "  constructor(readonly key: string) { super(`missing ${key}`) }",
      "}",
      "",
      "export function lookup(key: string): Result<string, Missing> {",
      "  if (key === \"\") throw new Missing(key)",
      "  return key",
      "}",
      "",
    ].join("\n");
    const appSource = [
      "import { lookup } from \"./domain.vibe\"",
      "",
      "export function greet(key:string):Result<string,Missing>{",
      "const name=lookup(key)!",
      "return `hello ${name}`",
      "}",
      "",
    ].join("\n");
    writeFileSync(domain, domainSource);
    writeFileSync(app, appSource);
    open(session, app, appSource);

    const definition = await session.response(session.request("textDocument/definition", {
      textDocument: { uri: pathToFileURL(app).href },
      position: { line: 3, character: 12 },
    }));
    assert.equal(definition.result.uri, pathToFileURL(domain).href);
    assert.equal(definition.result.range.start.line, 4);

    const formatting = await session.response(session.request("textDocument/formatting", {
      textDocument: { uri: pathToFileURL(app).href },
      options: { tabSize: 2, insertSpaces: true },
    }));
    assert.equal(formatting.result.length, 1);
    assert.equal(
      formatting.result[0].newText,
      [
        "import { lookup } from \"./domain.vibe\"",
        "",
        "export function greet(key: string): Result<string, Missing> {",
        "  const name = lookup(key)!",
        "  return `hello ${name}`",
        "}",
        "",
      ].join("\n"),
    );

    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("vibe lsp survives malformed framing and answers unknown methods per protocol", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);

    session.raw("Content-Bogus: 12\r\n\r\n");
    const framing = await session.next((message) => message.error !== undefined, "framing parse error");
    assert.equal(framing.id, null);
    assert.equal(framing.error.code, -32700);

    const body = "{ this is not json";
    session.raw(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    const parse = await session.next((message) => message.error !== undefined, "body parse error");
    assert.equal(parse.error.code, -32700);

    const unknown = await session.response(session.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(join(root, "none.vibe")).href },
      position: { line: 0, character: 0 },
      context: { includeDeclaration: true },
    }));
    assert.equal(unknown.error.code, -32601);
    assert.match(unknown.error.message, /textDocument\/references/);

    session.notify("workspace/somethingUnknown", { value: 1 });

    const shutdown = await session.response(session.request("shutdown"));
    assert.equal(shutdown.result, null);
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("vibe lsp exits 1 when exit arrives without shutdown", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    session.notify("exit");
    assert.equal(await session.exited, 1);
  });
});

test("vibe lsp exits 1 when its input stream closes without shutdown", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    session.child.stdin.end();
    assert.equal(await session.exited, 1);
  });
});
