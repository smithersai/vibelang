// The mapper has no per-project options.
export function mapperEntry(_config: unknown): { package: string; extensions: string[] } {
  return { package: "vibelang-ts-mapper", extensions: [".vibe"] }
}
