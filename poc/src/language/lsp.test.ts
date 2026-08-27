import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSmithersLanguageServer } from "./lsp.ts";

/* -------------------------------------------------------------------------- */
/* A minimal LSP client: real Content-Length framing over real streams.        */
/* -------------------------------------------------------------------------- */

interface Message {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly params?: Record<string, unknown>;
}

class Client {
  #buffer = Buffer.alloc(0);
  #messages: Message[] = [];
  #waiters: (() => void)[] = [];
  #nextId = 1;

  constructor(
    private readonly write: (chunk: string) => void,
    source: NodeJS.EventEmitter,
  ) {
    source.on("data", (chunk: Buffer | string) => {
      this.#buffer = Buffer.concat([
        this.#buffer,
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
      ]);
      this.#drain();
    });
  }

  #drain(): void {
    for (;;) {
      const separator = this.#buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const header = this.#buffer.subarray(0, separator).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) throw new TypeError(`server sent an unframed message: ${header}`);
      const length = Number.parseInt(match[1]!, 10);
      const bodyStart = separator + 4;
      if (this.#buffer.length < bodyStart + length) return;
      const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      this.#messages.push(JSON.parse(body) as Message);
      for (const waiter of this.#waiters.splice(0)) waiter();
    }
  }

  send(message: Record<string, unknown>): void {
    const body = JSON.stringify(message);
    this.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  raw(text: string): void {
    this.write(text);
  }

  request(method: string, params?: Record<string, unknown>): number {
    const id = this.#nextId++;
    this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    return id;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async next(predicate: (message: Message) => boolean, label: string): Promise<Message> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const index = this.#messages.findIndex(predicate);
      if (index >= 0) return this.#messages.splice(index, 1)[0]!;
      if (Date.now() > deadline) throw new TypeError(`timed out waiting for ${label}`);
      await new Promise<void>((resolveWith) => {
        const timer = setTimeout(resolveWith, 25);
        this.#waiters.push(() => {
          clearTimeout(timer);
          resolveWith();
        });
      });
    }
  }

  response(id: number): Promise<Message> {
    return this.next((message) => message.id === id, `response ${id}`);
  }

  notification(method: string, uri?: string): Promise<Message> {
    return this.next(
      (message) => message.method === method && (uri === undefined || message.params?.uri === uri),
      `${method} notification`,
    );
  }
}

interface Harness {
  readonly client: Client;
  readonly closed: Promise<number>;
}

function inProcessServer(): Harness {
  const input = new PassThrough();
  const output = new PassThrough();
  const errorOutput = new PassThrough();
  errorOutput.resume();
  const handle = startSmithersLanguageServer({ input, output, errorOutput });
  const client = new Client((chunk) => { input.write(chunk); }, output);
  return { client, closed: handle.closed };
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                   */
/* -------------------------------------------------------------------------- */

const FAILING = `class NotFound extends Error {
  constructor(readonly id: number) { super(\`missing \${id}\`) }
}

export function findUser(id: number) {
  if (id < 0) throw new NotFound(id)
  return id
}
`;

const PASSING = `class NotFound extends Error {
  constructor(readonly id: number) { super(\`missing \${id}\`) }
}

export function findUser(id: number): Result<number, NotFound> {
  if (id < 0) throw new NotFound(id)
  return id
}
`;

const DOMAIN = `export class Missing extends Error {
  constructor(readonly key: string) { super(\`missing \${key}\`) }
}

export function lookup(key: string): Result<string, Missing> {
  if (key === "") throw new Missing(key)
  return key
}
`;

const APP = `import { lookup } from "./domain.sm"

export function greet(key: string): Result<string, Missing> {
  return \`hello \${lookup(key)!}\`
}
`;

let workspace: string;
let failingPath: string;
let domainPath: string;
let appPath: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "smithers-lsp-"));
  failingPath = join(workspace, "failing.sm");
  domainPath = join(workspace, "domain.sm");
  appPath = join(workspace, "app.sm");
  await writeFile(failingPath, FAILING, "utf8");
  await writeFile(domainPath, DOMAIN, "utf8");
  await writeFile(appPath, APP, "utf8");
  // Real asset bytes for the stage-agreement tests below: the source-asset
  // stage reads the file, so a stub would not exercise it.
  await writeFile(join(workspace, "system.txt"), "You are a careful reviewer.\nAnswer with one sentence.\n", "utf8");
  await writeFile(join(workspace, "logo.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

function uriOf(path: string): string {
  return pathToFileURL(path).href;
}

async function initialize(client: Client): Promise<Message> {
  const id = client.request("initialize", {
    processId: null,
    rootUri: uriOf(workspace),
    capabilities: {},
    workspaceFolders: [{ uri: uriOf(workspace), name: "workspace" }],
  });
  const response = await client.response(id);
  client.notify("initialized", {});
  return response;
}

function open(client: Client, path: string, text: string, version = 1): void {
  client.notify("textDocument/didOpen", {
    textDocument: { uri: uriOf(path), languageId: "smithers", version, text },
  });
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("smithers lsp handshake", () => {
  test("publishes its bounded capability set and shuts down cleanly", async () => {
    const { client, closed } = inProcessServer();
    const response = await initialize(client);
    expect(response.error).toBeUndefined();
    const result = response.result as {
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    };
    expect(result.serverInfo.name).toBe("smithers-lsp");
    expect(result.capabilities).toEqual({
      positionEncoding: "utf-16",
      // 1 is TextDocumentSyncKind.Full: incremental sync is deliberately absent.
      textDocumentSync: { openClose: true, change: 1, save: false },
      hoverProvider: true,
      definitionProvider: true,
      documentFormattingProvider: true,
    });

    const shutdown = await client.response(client.request("shutdown"));
    expect(shutdown.result).toBeNull();
    client.notify("exit");
    expect(await closed).toBe(0);
  });

  test("exits with 1 when exit arrives without shutdown", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    client.notify("exit");
    expect(await closed).toBe(1);
  });

  test("refuses requests before initialize and after shutdown", async () => {
    const { client, closed } = inProcessServer();
    const early = await client.response(client.request("textDocument/hover", {
      textDocument: { uri: uriOf(failingPath) },
      position: { line: 0, character: 0 },
    }));
    expect(early.error?.code).toBe(-32002);

    await initialize(client);
    await client.response(client.request("shutdown"));
    const late = await client.response(client.request("textDocument/hover", {
      textDocument: { uri: uriOf(failingPath) },
      position: { line: 0, character: 0 },
    }));
    expect(late.error?.code).toBe(-32600);
    client.notify("exit");
    expect(await closed).toBe(0);
  });
});

describe("smithers lsp diagnostics", () => {
  test("publishes the exact frontend diagnostic and range for an opened module", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, failingPath, FAILING);
    const published = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    const diagnostics = published.params!.diagnostics as {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      severity: number;
      code: string;
      source: string;
      message: string;
    }[];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
      severity: 1,
      code: "SMITHERS1102",
      source: "smithers",
      message: "exported fallible functions must spell Result<A, E> (or Promise<Result<A, E>>) in their public contract",
    });
    client.notify("exit");
    await closed;
  });

  test("re-publishes after a full-document change", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, failingPath, FAILING);
    const first = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    expect((first.params!.diagnostics as unknown[]).length).toBe(1);

    client.notify("textDocument/didChange", {
      textDocument: { uri: uriOf(failingPath), version: 2 },
      contentChanges: [{ text: PASSING }],
    });
    const second = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    expect(second.params!.diagnostics).toEqual([]);
    expect(second.params!.version).toBe(2);

    client.notify("textDocument/didChange", {
      textDocument: { uri: uriOf(failingPath), version: 3 },
      contentChanges: [{ text: FAILING }],
    });
    const third = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    expect((third.params!.diagnostics as { code: string }[]).map((entry) => entry.code)).toEqual(["SMITHERS1102"]);
    client.notify("exit");
    await closed;
  });

  test("clears diagnostics when the document closes", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, failingPath, FAILING);
    await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    client.notify("textDocument/didClose", { textDocument: { uri: uriOf(failingPath) } });
    const cleared = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
    expect(cleared.params!.diagnostics).toEqual([]);
    client.notify("exit");
    await closed;
  });

  test("maps a generated-TypeScript error back to an authored position", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const broken = `export function bad(): Result<number, Error> {\n  return "not a number"\n}\n`;
    const path = join(workspace, "typed.sm");
    await writeFile(path, broken, "utf8");
    open(client, path, broken);
    const published = await client.notification("textDocument/publishDiagnostics", uriOf(path));
    const diagnostics = published.params!.diagnostics as { code: string; range: { start: { line: number } } }[];
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((entry) => entry.code.startsWith("TS"))).toBe(true);
    // The generated module has a runtime import header, so an unmapped
    // diagnostic would land on line 0; the source map puts it on the return.
    expect(diagnostics[0]!.range.start.line).toBe(1);
    client.notify("exit");
    await closed;
  });
});

/* -------------------------------------------------------------------------- */
/* Agreement with `smithers check`                                             */
/* -------------------------------------------------------------------------- */

/**
 * The language server used to run the row pass and the generated-TypeScript
 * pass but neither of the two compile stages that come before them, so it
 * judged a program the compiler never sees. Both directions are pinned here:
 * a valid program must publish NOTHING, and a refused one must publish the same
 * rule `smithers check` prints - not a later stage's guess about it.
 */
describe("smithers lsp stage agreement with the compiler", () => {
  async function publishedFor(name: string, text: string): Promise<{ code: string; line: number; character: number }[]> {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const path = join(workspace, name);
    await writeFile(path, text, "utf8");
    open(client, path, text);
    const published = await client.notification("textDocument/publishDiagnostics", uriOf(path));
    client.notify("exit");
    await closed;
    return (published.params!.diagnostics as {
      code: string;
      range: { start: { line: number; character: number } };
    }[]).map((entry) => ({
      code: entry.code,
      line: entry.range.start.line,
      character: entry.range.start.character,
    }));
  }

  test("a valid comptime program is clean, not TS2307 on the compiler-owned module", async () => {
    // Without the comptime stage the emitted module still imported
    // `smithers:comptime`, which no resolver answers, so a program `check`
    // accepts lit up red in an editor.
    expect(await publishedFor(
      "lsp-comptime-valid.sm",
      `import { comptime } from "smithers:comptime"\nexport const v: number = comptime(1 + 1)\n`,
    )).toEqual([]);
  });

  test("comptime refusals publish the comptime rule, not a later stage's stand-in", async () => {
    // Previously SMITHERS1603 (a host-sensitive global) - true of the lowered
    // program and not what the compiler reports about this one.
    expect(await publishedFor(
      "lsp-comptime-nondeterminism.sm",
      `import { comptime } from "smithers:comptime"\nexport const leak = comptime(Math.random())\n`,
    )).toEqual([{ code: "VCT1004", line: 1, character: 29 }]);

    // Previously TS2307, for the same reason as the valid case above.
    expect(await publishedFor(
      "lsp-comptime-imposter.sm",
      "import { comptime } from \"smithers:comptime\"\nexport const v = comptime`1 + 1`\n",
    )).toEqual([{ code: "VCT1006", line: 1, character: 17 }]);
  });

  test("a valid asset import is clean, not five errors led by SMITHERS1510", async () => {
    // Without the source-asset stage the row pass saw `./system.txt` as an
    // untrusted foreign module and charged the whole panic-channel cascade:
    // SMITHERS1510 + 1101 + 1301 + 1507 + 1508 on a green corpus program.
    expect(await publishedFor(
      "lsp-asset-text.sm",
      `import instructions from "./system.txt" with { type: "text" }\n` +
      `export function main(): string[] { return instructions.trimEnd().split("\\n") }\n`,
    )).toEqual([]);

    // A loader whose type TypeScript cannot resolve on its own. The generated
    // module has to reach the stock checker, or this is TS2307.
    expect(await publishedFor(
      "lsp-asset-bytes.sm",
      `import logo from "./logo.bin" with { type: "bytes" }\n` +
      "export function main(): string[] { return [`${logo.length}`] }\n",
    )).toEqual([]);
  });

  test("asset refusals publish the asset rule at the asset stage's own position", async () => {
    // Previously SMITHERS1510 - a different rule, about a different thing.
    expect(await publishedFor(
      "lsp-asset-absolute.sm",
      `import text from "/etc/hosts" with { type: "text" }\nexport const v = text\n`,
    )).toEqual([{ code: "SMITHERS5207", line: 0, character: 17 }]);

    expect(await publishedFor(
      "lsp-asset-no-attribute.sm",
      `import text from "./system.txt"\nexport const v = text\n`,
    )).toEqual([{ code: "SMITHERS5201", line: 0, character: 0 }]);
  });

  test("the stages did not displace the diagnostics that already worked", async () => {
    // The other direction. Each of these was correct before the stages were
    // added and has to stay correct: a frontend row rule, a host-global rule,
    // a compiler-owned module that is lowered by the emitter rather than by a
    // stage, and a program with no compiler-owned construct at all.
    expect(await publishedFor(
      "lsp-plain-failure.sm",
      `class NotFound extends Error {}\nexport function f(id: number) { if (id < 0) throw new NotFound(); return id }\n`,
    )).toEqual([{ code: "SMITHERS1102", line: 1, character: 0 }]);

    expect(await publishedFor(
      "lsp-host-global.sm",
      `export function f(): number { return process.pid }\n`,
    )).toEqual([{ code: "SMITHERS1601", line: 0, character: 37 }]);

    expect(await publishedFor(
      "lsp-exceptions.sm",
      `import { panic } from "smithers:exceptions"\n` +
      `export function f(x: boolean): string { if (x) panic("no"); return "y" }\n`,
    )).toEqual([]);

    expect(await publishedFor(
      "lsp-ordinary.sm",
      `export function double(n: number): number { return n * 2 }\n`,
    )).toEqual([]);
  });
});

describe("smithers lsp hover", () => {
  test("shows the checked channel and the inferred failure and requirement rows", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, domainPath, DOMAIN);
    const hover = await client.response(client.request("textDocument/hover", {
      textDocument: { uri: uriOf(domainPath) },
      // `lookup` on line 4 (0-based).
      position: { line: 4, character: 20 },
    }));
    const contents = (hover.result as { contents: { kind: string; value: string } }).contents;
    expect(contents.kind).toBe("markdown");
    expect(contents.value).toBe(
      "```smithers\n" +
      "export function lookup(key: string): Result<string, Missing>\n" +
      "```\n" +
      "\n" +
      "**channel** `Result`\n" +
      "\n" +
      "**failures** `Missing`\n" +
      "\n" +
      "**requirements** _none_",
    );
    client.notify("exit");
    await closed;
  });

  test("returns null outside any checked declaration", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, domainPath, DOMAIN);
    const hover = await client.response(client.request("textDocument/hover", {
      textDocument: { uri: uriOf(domainPath) },
      position: { line: 3, character: 0 },
    }));
    expect(hover.result).toBeNull();
    client.notify("exit");
    await closed;
  });
});

describe("smithers lsp definition", () => {
  test("resolves a project-local symbol across .sm modules", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, appPath, APP);
    const definition = await client.response(client.request("textDocument/definition", {
      textDocument: { uri: uriOf(appPath) },
      // `lookup(...)` inside the template literal on line 3 (0-based).
      position: { line: 3, character: 19 },
    }));
    const location = definition.result as { uri: string; range: { start: { line: number } } };
    expect(location.uri).toBe(uriOf(domainPath));
    expect(location.range.start.line).toBe(4);
    client.notify("exit");
    await closed;
  });

  test("resolves a relative module specifier", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, appPath, APP);
    const definition = await client.response(client.request("textDocument/definition", {
      textDocument: { uri: uriOf(appPath) },
      position: { line: 0, character: 30 },
    }));
    expect((definition.result as { uri: string }).uri).toBe(uriOf(domainPath));
    client.notify("exit");
    await closed;
  });
});

describe("smithers lsp formatting", () => {
  test("returns a whole-document edit produced by the formatter", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const unformatted = `export function f(value:number):number{\nreturn value*2\n}\n`;
    const path = join(workspace, "unformatted.sm");
    await writeFile(path, unformatted, "utf8");
    open(client, path, unformatted);
    const formatting = await client.response(client.request("textDocument/formatting", {
      textDocument: { uri: uriOf(path) },
      options: { tabSize: 2, insertSpaces: true },
    }));
    const edits = formatting.result as { range: unknown; newText: string }[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe(
      `export function f(value: number): number {\n  return value * 2\n}\n`,
    );
    expect(edits[0]!.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 3, character: 0 },
    });
    client.notify("exit");
    await closed;
  });

  test("returns no edits for an already formatted module", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    open(client, domainPath, DOMAIN);
    const formatting = await client.response(client.request("textDocument/formatting", {
      textDocument: { uri: uriOf(domainPath) },
      options: { tabSize: 2, insertSpaces: true },
    }));
    expect(formatting.result).toEqual([]);
    client.notify("exit");
    await closed;
  });

  test("returns no edits when the formatter fails closed", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const broken = `export function f(): number {\n  return (1 +\n}\n`;
    const path = join(workspace, "unparseable.sm");
    open(client, path, broken);
    const formatting = await client.response(client.request("textDocument/formatting", {
      textDocument: { uri: uriOf(path) },
      options: { tabSize: 2, insertSpaces: true },
    }));
    expect(formatting.result).toEqual([]);
    client.notify("exit");
    await closed;
  });
});

describe("smithers lsp protocol robustness", () => {
  test("answers an unknown request with MethodNotFound and keeps serving", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const unknown = await client.response(client.request("textDocument/rename", {
      textDocument: { uri: uriOf(domainPath) },
      position: { line: 0, character: 0 },
      newName: "x",
    }));
    expect(unknown.error?.code).toBe(-32601);
    expect(unknown.error?.message).toContain("textDocument/rename");

    const shutdown = await client.response(client.request("shutdown"));
    expect(shutdown.error).toBeUndefined();
    client.notify("exit");
    expect(await closed).toBe(0);
  });

  test("ignores an unknown notification", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    client.notify("telemetry/somethingElse", { value: 1 });
    const shutdown = await client.response(client.request("shutdown"));
    expect(shutdown.result).toBeNull();
    client.notify("exit");
    expect(await closed).toBe(0);
  });

  test("reports malformed framing and recovers on the next well-framed message", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    client.raw("Content-Bogus: 12\r\n\r\n");
    const parseError = await client.next((message) => message.error !== undefined, "parse error");
    expect(parseError.id).toBeNull();
    expect(parseError.error?.code).toBe(-32700);

    const shutdown = await client.response(client.request("shutdown"));
    expect(shutdown.result).toBeNull();
    client.notify("exit");
    expect(await closed).toBe(0);
  });

  test("reports a body that is not JSON", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    const body = "{not json";
    client.raw(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    const parseError = await client.next((message) => message.error !== undefined, "parse error");
    expect(parseError.error?.code).toBe(-32700);

    const shutdown = await client.response(client.request("shutdown"));
    expect(shutdown.result).toBeNull();
    client.notify("exit");
    expect(await closed).toBe(0);
  });

  test("rejects a JSON body that is not a JSON-RPC 2.0 message", async () => {
    const { client, closed } = inProcessServer();
    await initialize(client);
    client.send({ id: 99, method: "shutdown" });
    const invalid = await client.next((message) => message.error !== undefined, "invalid request");
    expect(invalid.error?.code).toBe(-32600);
    expect(invalid.id).toBe(99);
    client.notify("exit");
    expect(await closed).toBe(1);
  });
});

describe("smithers lsp as a real subprocess", () => {
  test("speaks the protocol over stdio and exits 0 after shutdown", async () => {
    const runner = join(workspace, "run-lsp.mjs");
    const lspModule = pathToFileURL(fileURLToPath(new URL("./lsp.ts", import.meta.url))).href;
    await writeFile(
      runner,
      `import { startSmithersLanguageServer } from ${JSON.stringify(lspModule)}\n` +
      `const handle = startSmithersLanguageServer()\n` +
      `process.exit(await handle.closed)\n`,
      "utf8",
    );
    const child = spawn(process.execPath, [runner], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const client = new Client((chunk) => { child.stdin.write(chunk); }, child.stdout);
    const exited = new Promise<number>((resolveWith) => {
      child.on("exit", (code) => resolveWith(code ?? -1));
    });
    try {
      await initialize(client);
      open(client, failingPath, FAILING);
      const published = await client.notification("textDocument/publishDiagnostics", uriOf(failingPath));
      expect((published.params!.diagnostics as { code: string }[]).map((entry) => entry.code))
        .toEqual(["SMITHERS1102"]);
      await client.response(client.request("shutdown"));
      client.notify("exit");
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 60_000);
});
