// The event log of FuzzVIPDifferential's programs. Both prints of a program
// import ev from this module; the Node worker resets the log before it calls
// main and reads it after the Effect ends.
let log = [];

export function ev(label) {
  log.push(String(label));
}

export function reset() {
  log = [];
}

export function events() {
  return log.slice();
}
