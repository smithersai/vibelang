import { join } from "node:path";

const root = join(import.meta.dir, "..");
const demos: Array<{ name: string; command: string[] }> = [
  { name: "language compile", command: ["bun", "src/language/cli.ts", "examples/language/demo.vibe"] },
  { name: "language runtime", command: ["bun", "examples/language/demo.generated.ts"] },
  { name: "comptime assets + schemas", command: ["bun", "examples/assets/demo.ts"] },
  { name: "target classification", command: ["bun", "examples/targets/demo.ts"] },
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

console.log("\nAll VibeLang POC surfaces completed.");

