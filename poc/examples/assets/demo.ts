import { join } from "node:path";
import { AssetCompiler, type AssetLoader, deriveSchema, parseWithSchema } from "../../src/build/index.ts";

const root = import.meta.dir;
const compiler = new AssetCompiler({
  root,
  cacheDirectory: join(root, ".demo-cache"),
  target: "typescript-node",
});

const keyValueLoader: AssetLoader = {
  id: "example:key-value",
  version: "1",
  implementationDigest: "example-key-value-loader-poc-v1",
  extensions: [".kv"],
  async load(asset, context) {
    const schema = JSON.parse(await context.readText("./settings.schema.json")) as { required: string[] };
    const value = Object.fromEntries(asset.text().trim().split("\n").map((line) => line.split("=", 2)));
    for (const key of schema.required) if (!(key in value)) throw new Error(`missing ${key}`);
    return {
      format: "key-value",
      value,
      emittedTypeScript: `export default ${JSON.stringify(value)} as const;\n`,
      declaration: "declare const value: Readonly<Record<string, string>>; export default value;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 0, sourceOffset: 0 }],
    };
  },
};

compiler.register(keyValueLoader);

const json = await compiler.compile("config.json", { const: true });
const mdx = await compiler.compile("coding-agent.mdx");
const custom = await compiler.compile("settings.kv");
const repeated = await compiler.compile("settings.kv");

const schema = deriveSchema(`
  type Region = "us-west" | "us-east";
  interface Settings { region: Region; retries: number; labels?: string[] }
`, "Settings");
const settings = parseWithSchema<{ region: string; retries: number }>(schema, {
  region: "us-west",
  retries: Number((custom.module.value as Record<string, string>).retries),
});

console.log(JSON.stringify({
  jsonKey: json.key.slice(0, 12),
  jsonLiteralEmit: json.module.emittedTypeScript.includes("as const"),
  mdxComponents: (mdx.module.value as { components: string[] }).components,
  trackedDependencies: custom.dependencies.map((dependency) => dependency.path.split("/").at(-1)),
  cacheHit: repeated.cacheHit,
  validated: settings,
}, null, 2));
