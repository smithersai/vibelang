// This module deliberately carries no leading `@module` / `@throws {never}`
// initialization trust claim, so a `.vibe` module may not statically import it.

export function shout(text: string): string {
  return `${text.toUpperCase()}!`;
}

/**
 * A type-only export. A `.vibe` module may `import type { Settings }` from this
 * untrusted module without the initialization trust claim, because a type-only
 * import creates no runtime requirement and no module initializer edge.
 */
export interface Settings {
  readonly retries: number;
}
