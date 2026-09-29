// Error handling shared by all web modules.
//
// Web methods never throw to the page. They return
//   { ok: true, data }                       on success
//   { ok: false, error: { code, message } }  on a handled failure
// so page code can show `error.message` directly. Unexpected errors are logged
// (visible in the site's Logs) and returned as a generic message, so internal
// details never reach the browser.

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export const ERR = Object.freeze({
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',           // state changed underneath us (e.g. someone else claimed first)
  TABLE_FULL: 'TABLE_FULL',
  ALREADY_BOOKED: 'ALREADY_BOOKED', // already seated or DMing that night
  NOT_OPEN: 'NOT_OPEN',           // table/occurrence isn't accepting this action
  PAST_EVENT: 'PAST_EVENT',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INTERNAL: 'INTERNAL',
});

export function fail(code, message) {
  throw new AppError(code, message);
}

// Wraps a web method body so it returns the { ok, data | error } envelope.
export function handled(fn) {
  return async (...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, error: { code: err.code, message: err.message } };
      }
      console.error('Unexpected backend error', err);
      return {
        ok: false,
        error: { code: ERR.INTERNAL, message: 'Something went wrong. Please try again, or contact the organizers if it keeps happening.' },
      };
    }
  };
}
