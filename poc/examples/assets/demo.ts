import { join } from "node:path";
import {
  AssetCompiler,
  compileSourceAssetModules,
  createSandboxedLoader,
  deriveSchema,
  parseWithSchema,
} from "../../src/build/index.ts";

const root = import.meta.dir;
const compiler = new AssetCompiler({
  root,
  cacheDirectory: join(root, ".demo-cache"),
  target: "typescript-node",
});

const keyValueLoader = createSandboxedLoader({
  id: "example:key-value",
  version: "1",
  extensions: [".kv"],
  modulePath: join(root, "key-value-loader.ts"),
});

compiler.register(keyValueLoader);

const json = await compiler.compile("config.json", { const: true });
const mdx = await compiler.compile("coding-agent.mdx");
const markdown = await compiler.compile("guide.md", { type: "markdown" });
const custom = await compiler.compile("settings.kv");
const repeated = await compiler.compile("settings.kv");

// Provisional parsed-document shapes. `{ type: "text" }` still returns the
// raw string; `{ type: "markdown" }` adds frontmatter/body/headings and MDX
// adds a render tree whose `{name}` holes stay unevaluated placeholders.
const markdownValue = markdown.module.value as {
  frontmatter: Record<string, unknown>;
  headings: Array<{ level: number; text: string; offset: number }>;
};
const mdxValue = mdx.module.value as {
  components: string[];
  expressions: string[];
  tree: Array<{ kind: string; name?: string }>;
};

const schema = deriveSchema(`
  type Region = "us-west" | "us-east";
  interface Settings { region: Region; retries: number; labels?: string[] }
`, "Settings");
const settings = parseWithSchema<{ region: string; retries: number }>(schema, {
  region: "us-west",
  retries: Number((custom.module.value as Record<string, string>).retries),
});

// The authored asset graph: a static import whose loader declares a nested
// module edge, a re-export, and a literal dynamic import.
const graphCompiler = new AssetCompiler({
  root,
  cacheDirectory: join(root, ".demo-cache", "graph"),
  target: "typescript-node",
}).register(createSandboxedLoader({
  id: "example:key-value-nested",
  version: "1",
  extensions: [".kv"],
  types: ["kv"],
  modulePath: join(root, "key-value-nested-loader.ts"),
}));

const graph = await compileSourceAssetModules({
  compiler: graphCompiler,
  sources: [{
    fileName: "usage.sm",
    source: [
      'import settings from "./settings.kv" with { type: "kv" }',
      'import guide from "./guide.md" with { type: "markdown" }',
      'import agentPrompt from "./coding-agent.mdx" with { type: "mdx" }',
      'export { default as config } from "./config.json" with { type: "json", mode: "const" }',
      'export const prompt = async () => (await import("./overview.md", { with: { type: "text" } })).default',
      "export { settings, guide, agentPrompt }",
      "",
    ].join("\n"),
  }],
});

// Provisional source-level registration: no `createSandboxedLoader` call here.
// `yaml-loader.ts` default-exports `comptime.loader("yaml", load)`, the
// preflight recognizes it by checker identity, and the loader still runs only
// inside the sandbox.
const sourceRegisteredCompiler = new AssetCompiler({
  root,
  cacheDirectory: join(root, ".demo-cache", "source-loader"),
  target: "typescript-node",
});

const sourceRegistered = await compileSourceAssetModules({
  compiler: sourceRegisteredCompiler,
  loaders: ["yaml-loader.ts"],
  sources: [{
    fileName: "app-config.sm",
    source: [
      'import config from "./app.yaml" with { type: "yaml" }',
      "export const region = config.region",
      "",
    ].join("\n"),
  }],
});

console.log(JSON.stringify({
  jsonKey: json.key.slice(0, 12),
  jsonLiteralEmit: json.module.emittedTypeScript.includes("as const"),
  mdxComponents: mdxValue.components,
  mdxPlaceholders: mdxValue.expressions,
  mdxTreeKinds: mdxValue.tree.map((node) => node.name ?? node.kind),
  markdownFrontmatter: markdownValue.frontmatter,
  markdownHeadings: markdownValue.headings,
  trackedDependencies: custom.dependencies.map((dependency) => dependency.path.split("/").at(-1)),
  cacheHit: repeated.cacheHit,
  validated: settings,
  assetGraph: {
    ok: graph.ok,
    diagnostics: graph.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    modules: graph.modules.map((module) => ({
      asset: module.resolutionAliases[0],
      depth: module.depth,
      references: module.references.length,
    })),
  },
  sourceRegisteredLoader: {
    ok: sourceRegistered.ok,
    diagnostics: sourceRegistered.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    loader: sourceRegistered.modules[0]?.loader,
    trackedDependencies: sourceRegistered.modules[0]?.dependencies.map((dependency) => dependency.path),
    emitted: sourceRegistered.modules[0]?.source.split("\n").at(-3),
  },
}, null, 2));
