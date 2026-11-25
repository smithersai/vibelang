// The event log of FuzzVIPDifferential's programs. Both prints of a program
// import ev from this module; the Node worker resets the log before it calls
// main and reads it after the Effect ends.
let log = [];
let serializationFailure;

export function stringifyObservation(value, replacer) {
  try {
    return JSON.stringify(value, replacer);
  } catch (cause) {
    serializationFailure = new Error("Could not serialize VIP observation", { cause });
    return "";
  }
}

export function ev(label) {
  log.push(String(label));
}

export function raise(value) {
  throw value;
}

export function reset() {
  serializationFailure = undefined;
  log = [];
}

export function events() {
  if (serializationFailure) throw serializationFailure;
  return log.slice();
}
