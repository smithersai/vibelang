interface Asset {
  text(): string;
}

interface ImportedAsset {
  logicalKey: string;
  module: { value: unknown };
}

interface Context {
  import(specifier: string, options?: Record<string, unknown>): Promise<ImportedAsset>;
}

/**
 * The nested-graph variant of key-value-loader.ts. The schema is a tracked
 * module edge rather than tracked text: the generated module imports the
 * schema's own generated module by its deterministic logical key instead of
 * inlining its bytes, so editing the schema invalidates both modules.
 */
export default async function load(asset: Asset, context: Context) {
  const schema = await context.import("./settings.schema.json", { type: "json", mode: "const" });
  const value = Object.fromEntries(asset.text().trim().split("\n").map((line) => line.split("=", 2)));
  for (const key of (schema.module.value as { required: string[] }).required) {
    if (!(key in value)) throw new Error(`missing ${key}`);
  }
  return {
    format: "key-value",
    value,
    emittedTypeScript: `import schema from "./${schema.logicalKey}.ts";\n` +
      `const value = { entries: ${JSON.stringify(value)}, schema: schema };\nexport default value;\n`,
    declaration: "declare const value: { entries: Readonly<Record<string, string>>; schema: unknown };\n" +
      "export default value;\n",
    diagnostics: [],
    spans: [{ generatedOffset: 0, sourceOffset: 0 }],
  };
}
