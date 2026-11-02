// @effect-diagnostics nodeBuiltinImport:off -- This platform boundary asks the OS for its foreground window with Node.

import * as NodeChildProcess from "node:child_process";

/** id is CGWindowNumber on macOS or HWND on Windows, matching the capture backend. */
export type ActiveWindow = { readonly id: number; readonly title: string };

export function title(id: number): string {
  return String(NodeChildProcess.execFileSync("osascript", [String(id)]));
}
