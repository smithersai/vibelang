export const webBody = new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
export const response = { once: (_event: "close", _listener: () => void) => undefined, off: (_event: "close", _listener: () => void) => undefined }
export const signal = { aborted: false }
export const readable = { destroy: () => undefined, once: (_event: "close", _listener: () => void) => undefined }
