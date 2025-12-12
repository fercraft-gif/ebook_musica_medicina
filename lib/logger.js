// /lib/logger.js
const DEBUG = process.env.DEBUG_LOGS === "1";

export function log(...args) {
  if (DEBUG) console.log(...args);
}

export function warn(...args) {
  if (DEBUG) console.warn(...args);
}

export function error(...args) {
  // ERROS SEMPRE aparecem (isso é importante pra você saber quando quebrou)
  console.error(...args);
}
