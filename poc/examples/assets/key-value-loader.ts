interface Asset {
  text(): string;
}

interface Context {
  readText(specifier: string): Promise<string>;
}

export default async function load(asset: Asset, context: Context) {
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
}
