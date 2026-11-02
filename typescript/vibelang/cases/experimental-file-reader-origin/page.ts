import { FileReader } from "vibelang-runtime/experimental"
/** @throws {never} */
export const blob = (): Blob => new Blob(["foldkit"])
/** @throws {never} */
export const invalidReader = (): FileReader.FileReader => FileReader.make({
  makeReader: () => {
    const listeners: Record<string, () => void> = {}
    return {
      result: null, error: null,
      addEventListener: (type, listener) => { listeners[type] = listener },
      abort: () => {},
      readAsText: () => { queueMicrotask(() => listeners.load!()) },
      readAsDataURL: () => { queueMicrotask(() => listeners.load!()) },
      readAsArrayBuffer: () => { queueMicrotask(() => listeners.load!()) }
    }
  }
})
