// Only the structural socket API used here; the runtime import stays Worker-only.
declare module "cloudflare:sockets" {
  export function connect(address: { readonly hostname: string; readonly port: number }): {
    readonly readable: ReadableStream<Uint8Array>
    readonly writable: WritableStream<Uint8Array>
    readonly closed: Promise<unknown>
    readonly close: () => Promise<unknown>
  }
}
