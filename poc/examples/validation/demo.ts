/**
 * `comptime(Schema.derive<T>())` end to end.
 *
 * The authored module below declares one ordinary type and never writes a
 * schema. The comptime frontend resolves `Schema` from the compiler-owned
 * "vibelang:schema" module by checker identity, reifies the type into a
 * canonical descriptor, and lowers the call site to a literal schema value
 * bound to the runtime engine. The lowered program is then executed here.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ComptimeCompiler, compileComptimeIntrinsics } from "../../src/build/index.ts";

const root = await mkdtemp(join(tmpdir(), "vibelang-validation-demo-"));
const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node" });

const authored = [
  `import { comptime } from "vibelang:comptime";`,
  `import { Schema } from "vibelang:schema";`,
  ``,
  `type SignupRequest = {`,
  `  email: string;`,
  `  age: number;`,
  `  role: "admin" | "member";`,
  `  tags: string[];`,
  `  nickname?: string;`,
  `};`,
  ``,
  `const SignupRequestSchema = comptime(Schema.derive<SignupRequest>());`,
  ``,
  `export function handleSignup(body: unknown): string {`,
  `  return SignupRequestSchema.parse(body).match({`,
  `    ok: (request: SignupRequest) => "welcome " + request.email,`,
  `    error: (failure) => "rejected " + failure.pointer + " " + failure.reason,`,
  `  });`,
  `}`,
].join("\n");

const result = await compileComptimeIntrinsics({
  compiler,
  sources: { "signup.ts": authored },
  // Deterministic module edge for the derived-schema runtime engine.
  schemaRuntimeImport: resolve(import.meta.dir, "../../src/build/schema-runtime.ts"),
});

if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));

const lowered = result.loweredSources!["signup.ts"]!;
console.log("descriptor:", JSON.stringify(result.calls[0]!.value));
console.log("lowered call site:", lowered.split("\n").find((line) => line.includes("__vsSchema<")));

const modulePath = join(root, "signup.ts");
await writeFile(modulePath, lowered);
const { handleSignup } = await import(modulePath) as { handleSignup: (body: unknown) => string };

console.log(handleSignup({ email: "ada@example.com", age: 36, role: "admin", tags: ["founder"] }));
console.log(handleSignup({ email: "ada@example.com", age: 36, role: "owner", tags: ["founder"] }));
console.log(handleSignup({ email: "ada@example.com", age: 36, role: "admin", tags: ["founder", 7] }));
console.log(handleSignup({ email: "ada@example.com", age: 36, role: "admin" }));
