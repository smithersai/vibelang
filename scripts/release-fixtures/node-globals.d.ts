/**
 * Minimal stand-in for the `@types/node` ambient that a Node consumer supplies.
 * `smthrs/platform` types its terminal streams as `NodeJS.ReadableStream` and
 * `NodeJS.WritableStream`, and `@types/node` is a development dependency that a
 * plain `npm install smthrs` never brings along, so the release type consumer
 * declares the namespace itself rather than weakening `types: []`.
 *
 * Kept deliberately small, exactly like `bun-sqlite.d.ts`: it exists so the
 * packaged declarations resolve, not to reproduce Node's stream API.
 */
declare namespace NodeJS {
  interface ReadableStream {
    read(size?: number): string | Uint8Array | null;
    setEncoding(encoding: string): this;
    pause(): this;
    resume(): this;
  }
  interface WritableStream {
    write(chunk: string | Uint8Array): boolean;
    end(): this;
  }
}
