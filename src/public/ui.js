// Small helpers shared by the booking pages. Frontend only: no rules live here.

export const VENUE_TZ = 'America/Denver';

// Repeater item IDs may only contain letters, digits and hyphens (Wix rule), but our IDs
// contain underscores and colons. Map to a safe ID and keep the real one in `id`.
export function rid(id) {
  return String(id).replace(/[^A-Za-z0-9-]/g, 'x');
}

// Setting data to [] first forces every item to be rebuilt, so onItemReady (and its click
// handlers) run again with fresh data. Without this, items whose _id didn't change keep old text.
export function setRepeater(repeater, rows) {
  repeater.data = [];
  repeater.data = rows;
}

// Always shown in the venue's time zone, whatever the viewer's device is set to.
export function fmtWhen(startsAt, endsAt) {
  const start = new Date(startsAt);
  const day = start.toLocaleDateString('en-US', { timeZone: VENUE_TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const time = (d) => d.toLocaleTimeString('en-US', { timeZone: VENUE_TZ, hour: 'numeric', minute: '2-digit' });
  return endsAt ? `${day} · ${time(start)} – ${time(new Date(endsAt))}` : `${day} · ${time(start)}`;
}

export function fmtDate(value) {
  return new Date(value).toLocaleDateString('en-US', { timeZone: VENUE_TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

// Calls a web method that returns { ok, data | error } and unwraps it.
// Throws an Error whose message is safe to show on the page.
export async function call(webMethodFn, ...args) {
  let res;
  try {
    res = await webMethodFn(...args);
  } catch (err) {
    console.error(err);
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!res || !res.ok) {
    const err = new Error((res && res.error && res.error.message) || 'Something went wrong. Please try again.');
    err.code = res && res.error && res.error.code;
    throw err;
  }
  return res.data;
}

// Sets a text element and collapses it when empty, so blank lines don't take space on mobile.
export function setText(el, value) {
  const text = value === undefined || value === null ? '' : String(value);
  el.text = text;
  if (text) el.expand(); else el.collapse();
}

// Disables a button while an action runs and restores it afterwards.
export async function withBusy(button, busyLabel, action) {
  const original = button.label;
  button.disable();
  button.label = busyLabel;
  try {
    return await action();
  } finally {
    button.label = original;
    button.enable();
  }
}

// Tap-twice confirmation for destructive actions (Velo has no built-in confirm dialog).
// The first tap changes the label; a second tap within 5 seconds runs the action.
export function onConfirmedClick(button, confirmLabel, action) {
  const original = button.label;
  let armedUntil = 0;
  button.onClick(async () => {
    if (Date.now() > armedUntil) {
      armedUntil = Date.now() + 5000;
      button.label = confirmLabel;
      setTimeout(() => {
        if (armedUntil && Date.now() >= armedUntil) button.label = original;
      }, 5100);
      return;
    }
    armedUntil = 0;
    button.label = original;
    await action();
  });
}

export function inputValue(el) {
  return typeof el.value === 'string' ? el.value.trim() : el.value;
}

export function clearInputs(...els) {
  els.forEach((el) => { el.value = ''; });
}
