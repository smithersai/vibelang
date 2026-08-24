import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "..");
// The language demo uses an async Layer.provide scope. That boundary requires
// exact Promise-settlement hooks, which Node provides and Bun does not, so Bun
// only transpiles the bundle and Node executes it; running the generated file
// directly under Bun exercises the documented fail-closed rejection instead.
const stagedLanguageDemo = join(mkdtempSync(join(tmpdir(), "smithers-demo-")), "language-demo.mjs");
const demos: Array<{ name: string; command: string[] }> = [
  { name: "language compile", command: ["bun", "src/language/cli.ts", "examples/language/demo.sm"] },
  {
    name: "language runtime bundle",
    command: ["bun", "build", "examples/language/demo.generated.ts", "--target=node", `--outfile=${stagedLanguageDemo}`],
  },
  { name: "language runtime", command: ["node", stagedLanguageDemo] },
  { name: "comptime assets + schemas", command: ["bun", "examples/assets/demo.ts"] },
  { name: "runtime validation", command: ["bun", "examples/validation/demo.ts"] },
  { name: "platform services", command: ["bun", "examples/platform/demo.ts"] },
  { name: "structured concurrency", command: ["bun", "examples/concurrency/demo.ts"] },
  { name: "Zig/Rust imports", command: ["bun", "examples/polyglot/demo.ts"] },
  { name: "durable execution", command: ["bun", "examples/durable/demo.ts"] },
  { name: "code-writing agent", command: ["bun", "examples/agent/demo.ts"] },
];

for (const demo of demos) {
  console.log(`\n=== ${demo.name} ===`);
  const process = Bun.spawn(demo.command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  if (exitCode !== 0) throw new Error(`${demo.name} failed with exit code ${exitCode}`);
}

console.log("\nAll Smithers POC surfaces completed.");

