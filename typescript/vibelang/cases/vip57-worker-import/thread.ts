import { isMainThread } from "node:worker_threads"

/**
 * Whether this code runs on the main thread.
 * @throws {never}
 */
export function onMainThread(): boolean {
  return isMainThread
}
