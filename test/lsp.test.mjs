import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

/**
 * A minimal LSP client over a real `smithers lsp` subprocess: correctly framed
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
  const child = spawn(process.execPath, ["bin/smithers.js", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new LspSession(child);
}

async function withServer(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "smithers-lsp-")));
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
    textDocument: { uri: pathToFileURL(path).href, languageId: "smithers", version, text },
  });
}

test("smithers lsp completes the initialize handshake over stdio", async () => {
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
    assert.equal(response.result.serverInfo.name, "smithers-lsp");

    const shutdown = await session.response(session.request("shutdown"));
    assert.equal(shutdown.result, null);
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("smithers lsp publishes the exact frontend diagnostic and range, and updates it on change", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const file = join(root, "failing.sm");
    writeFileSync(file, FAILING);
    const uri = pathToFileURL(file).href;

    open(session, file, FAILING);
    const first = await session.published(uri);
    assert.deepEqual(first.params.diagnostics, [{
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
      severity: 1,
      code: "SMITHERS1102",
      source: "smithers",
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
    assert.deepEqual(third.params.diagnostics.map((entry) => entry.code), ["SMITHERS1102"]);

    await session.response(session.request("shutdown"));
    session.notify("exit");
    assert.equal(await session.exited, 0);
  });
});

test("smithers lsp hover shows the checked channel and inferred rows", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const file = join(root, "domain.sm");
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
        "```smithers",
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

test("smithers lsp resolves definitions and formats documents", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    const domain = join(root, "domain.sm");
    const app = join(root, "app.sm");
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
      "import { lookup } from \"./domain.sm\"",
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
        "import { lookup } from \"./domain.sm\"",
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

test("smithers lsp survives malformed framing and answers unknown methods per protocol", async () => {
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
      textDocument: { uri: pathToFileURL(join(root, "none.sm")).href },
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

test("smithers lsp exits 1 when exit arrives without shutdown", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    session.notify("exit");
    assert.equal(await session.exited, 1);
  });
});

test("smithers lsp exits 1 when its input stream closes without shutdown", async () => {
  await withServer(async (session, root) => {
    await initialize(session, root);
    session.child.stdin.end();
    assert.equal(await session.exited, 1);
  });
});
