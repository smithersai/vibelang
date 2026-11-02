export function takeNative(subject: unknown): unknown {
  if ((typeof subject !== "object" && typeof subject !== "function") || subject === null || !("child" in subject)) return "missing"
  const child = subject.child
  if ((typeof child !== "object" && typeof child !== "function") || child === null || !("items" in child)) return "missing"
  const items = child.items
  if (!Array.isArray(items) || items.length !== 1) return "missing"
  return items[0]
}
