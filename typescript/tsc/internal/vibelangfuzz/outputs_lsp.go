package vibelangfuzz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// Native stock TypeScript 7 exposes diagnostic ends through LSP, rather than
// lib/typescript.js. Chapter 28 and D266 require the same source diagnostics
// in the editor and CLI. This worker follows the protocol already exercised
// by packages/ts-mapper/test/lsp-hover.mjs, and uses no installed JS API.
// Configuration diagnostics still participate in the CLI comparison; LSP
// supplies complete spans for project source files only.
const stockLSPWorker = `const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const [tsc, encoded] = process.argv.slice(1);
const files = JSON.parse(encoded);
const server = spawn(tsc, ["--lsp", "--stdio"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
let log = "", buffer = Buffer.alloc(0), next = 1;
const pending = new Map();
function send(value) { const data = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...value })); server.stdin.write("Content-Length: " + data.length + "\r\n\r\n"); server.stdin.write(data); }
function request(method, params) { const id = next++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send({ id, method, params }); }); }
function fail(error) { for (const { reject } of pending.values()) reject(error); pending.clear(); }
server.on("error", fail);
server.on("exit", code => fail(new Error("stock LSP exited " + code + ": " + log)));
server.stderr.on("data", data => log = (log + data).slice(-2000));
server.stdout.on("data", data => {
 buffer = Buffer.concat([buffer, data]);
 for (;;) {
  const split = buffer.indexOf("\r\n\r\n"); if (split < 0) return;
  const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, split).toString());
  if (!match) { fail(new Error("invalid LSP framing")); return; }
  const length = Number(match[1]); if (buffer.length < split + 4 + length) return;
  const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString());
  buffer = buffer.subarray(split + 4 + length);
  if (message.method && message.id !== undefined) {
   send({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map(() => null) : null });
  } else if (message.id !== undefined && pending.has(message.id)) {
   const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
   if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  }
 }
});
const offset = (text, position) => {
 const starts = [0]; const lines = /\r\n|[\n\r\u2028\u2029]/g; let match;
 while ((match = lines.exec(text))) starts.push(lines.lastIndex);
 if (position.line >= starts.length) throw new Error("diagnostic line outside text");
 return starts[position.line] + position.character;
};
(async () => {
 const rootUri = pathToFileURL(process.cwd() + "/").href;
 await request("initialize", { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "fuzz" }], capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} } } });
 send({ method: "initialized", params: {} });
 const spans = [];
 for (const file of files) {
  const uri = pathToFileURL(resolve(file)).href, text = readFileSync(file, "utf8");
  send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: file.endsWith(".tsx") ? "typescriptreact" : "typescript", version: 1, text } } });
  const result = await request("textDocument/diagnostic", { textDocument: { uri } });
  if (result.kind !== "full") throw new Error("stock LSP did not return full diagnostics");
  for (const diagnostic of result.items ?? []) {
   // A hint is an editor suggestion, such as TS6133 for an unused name, which
   // no command line reports; D266 compares what the compiler reports.
   if ((diagnostic.source && diagnostic.source !== "ts") || diagnostic.severity === 4) continue;
   spans.push({ file, start: offset(text, diagnostic.range.start), end: offset(text, diagnostic.range.end), code: Number(diagnostic.code), category: diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "message" });
  }
  send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
 }
 console.log(JSON.stringify(spans));
 await request("shutdown", null); send({ method: "exit" }); server.kill();
})().catch(error => { console.error(String(error) + "\n" + log); server.kill(); process.exitCode = 1; });`

func stockLSPSpans(ctx context.Context, tsc, dir string, files []string) ([]stockSpan, error) {
	if files == nil {
		files = []string{}
	}
	encoded, _ := json.Marshal(files)
	cmd := exec.CommandContext(ctx, "node", "-e", stockLSPWorker, tsc, string(encoded))
	cmd.Dir = dir
	var stderr strings.Builder
	cmd.Stderr = &stderr
	var output bytes.Buffer
	cmd.Stdout = &output
	err := runChild(cmd)
	out := output.Bytes()
	// The worker prints the spans before it shuts the server down; a server
	// that ends untidily after answering does not change what it answered.
	var spans []stockSpan
	if jsonErr := json.Unmarshal(out, &spans); jsonErr != nil {
		return nil, fmt.Errorf("stock LSP diagnostic spans: %v, %v: %.1000s%.1000s", err, jsonErr, out, stderr.String())
	}
	return spans, nil
}
