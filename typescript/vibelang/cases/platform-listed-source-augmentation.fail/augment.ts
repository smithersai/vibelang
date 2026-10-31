export {}
declare global {
  interface XMLHttpRequest { readonly projectOnly?: boolean }
  interface EventSource { readonly projectOnly?: boolean }
  interface WebSocket { readonly projectOnly?: boolean }
  interface SharedWorker { readonly projectOnly?: boolean }
}
