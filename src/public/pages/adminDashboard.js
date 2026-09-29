// Admin dashboard (/admin). For the site owner and admin collaborators, logged in on the
// live site. Element IDs are in docs/ui-elements.md.
//
//   import { initAdminDashboardPage } from 'public/pages/adminDashboard.js';
//   $w.onReady(() => initAdminDashboardPage($w));
//
// Series creation and occurrence generation are added in stage 4.

import { listUpcomingOccurrences } from 'backend/events.web';
import {
  getAdminQueue, approveClaim, denyClaim, decideReleaseRequest, adminReleaseClaim,
  getOccurrenceAdminView, editOccurrence, cancelOccurrence, addTable, editTable, removeTable,
  adminAddBooking, adminRemoveBooking, decideDmApplication, listDms, revokeDm,
} from 'backend/admin.web';
import {
  rid, setRepeater, fmtWhen, fmtDate, call, setText, withBusy, onConfirmedClick, inputValue, clearInputs,
} from 'public/ui.js';

const state = { nightId: null, night: null };

// Shows the result of any admin action in one place at the top of the page.
function report($w, text, isError = false) {
  setText($w('#adminMessage'), isError ? '' : text);
  setText($w('#adminError'), isError ? text : '');
}

// Runs an admin action with a busy button, reports the outcome, and refreshes what it touched.
function action($w, button, busyLabel, fn, successText, refresh) {
  return withBusy(button, busyLabel, async () => {
    try {
      const result = await fn();
      report($w, typeof successText === 'function' ? successText(result) : successText);
      if (refresh) await refresh();
    } catch (err) {
      report($w, err.message, true);
    }
  });
}

function claimSummary(c) {
  const when = c.occurrence ? fmtWhen(c.occurrence.startsAt, c.occurrence.endsAt) : '';
  const table = c.table ? c.table.name : '';
  return { when, table: `${table}${c.occurrence ? ` · ${c.occurrence.title}` : ''}` };
}

export function initAdminDashboardPage($w) {
  report($w, '');
  $w('#nightBox').collapse();
  wireQueue($w);
  wireNight($w);
  wireDms($w);
  loadAll($w);
}

async function loadAll($w) {
  try {
    await Promise.all([loadQueue($w), loadNightPicker($w), loadDms($w)]);
  } catch (err) {
    report($w, err.message, true);
  }
}

// ---------- Queue: claims, late release requests, DM applications ----------

async function loadQueue($w) {
  const q = await call(getAdminQueue);
  const rows = (list, key) => list.map((x) => ({ ...x, _id: rid(x[key]), id: x[key] }));
  setRepeater($w('#claimsRepeater'), rows(q.pendingClaims, 'claimId'));
  setRepeater($w('#releaseRepeater'), rows(q.releaseRequests, 'claimId'));
  setRepeater($w('#appsRepeater'), rows(q.dmApplications, '_id'));
  setText($w('#claimsEmpty'), q.pendingClaims.length ? '' : 'No claims waiting.');
  setText($w('#releaseEmpty'), q.releaseRequests.length ? '' : 'No release requests.');
  setText($w('#appsEmpty'), q.dmApplications.length ? '' : 'No DM applications.');
}

function wireQueue($w) {
  const refresh = () => loadQueue($w);

  $w('#claimsRepeater').onItemReady(($item, c) => {
    const s = claimSummary(c);
    $item('#cqWhen').text = s.when;
    $item('#cqTable').text = s.table;
    $item('#cqDm').text = `DM: ${c.dmDisplayName}`;
    $item('#cqGame').text = `${c.gameTitle} (${c.system}) · up to ${c.playerCap} players`;
    setText($item('#cqDetails'), [c.description, c.contentNotes ? `Content notes: ${c.contentNotes}` : ''].filter(Boolean).join('\n'));
    $item('#cqApprove').onClick(() => action($w, $item('#cqApprove'), 'Approving…',
      () => call(approveClaim, c.id), `Approved ${c.gameTitle}.`, refresh));
    $item('#cqDeny').onClick(() => action($w, $item('#cqDeny'), 'Denying…',
      () => call(denyClaim, c.id, inputValue($item('#cqReason'))), `Denied ${c.gameTitle}.`, refresh));
  });

  $w('#releaseRepeater').onItemReady(($item, c) => {
    const s = claimSummary(c);
    $item('#rqWhen').text = s.when;
    $item('#rqTable').text = s.table;
    $item('#rqDm').text = `DM: ${c.dmDisplayName} · ${c.gameTitle}`;
    setText($item('#rqReason'), c.releaseReason ? `DM's reason: ${c.releaseReason}` : 'No reason given.');
    $item('#rqApprove').onClick(() => action($w, $item('#rqApprove'), 'Releasing…',
      () => call(decideReleaseRequest, c.id, true, inputValue($item('#rqNote'))),
      (r) => `Released. ${r.playersRemoved} player(s) removed.`, refresh));
    $item('#rqDeny').onClick(() => action($w, $item('#rqDeny'), 'Saving…',
      () => call(decideReleaseRequest, c.id, false, inputValue($item('#rqNote'))), 'Release denied; the DM keeps the table.', refresh));
  });

  $w('#appsRepeater').onItemReady(($item, a) => {
    $item('#apName').text = a.displayName;
    $item('#apExperience').text = a.experience;
    $item('#apSystems').text = `Runs: ${a.systems}`;
    setText($item('#apNotes'), a.notes);
    $item('#apApprove').onClick(() => action($w, $item('#apApprove'), 'Approving…',
      () => call(decideDmApplication, a.id, true, inputValue($item('#apNote'))),
      `${a.displayName} is now a DM.`, () => Promise.all([loadQueue($w), loadDms($w)])));
    $item('#apDeny').onClick(() => action($w, $item('#apDeny'), 'Saving…',
      () => call(decideDmApplication, a.id, false, inputValue($item('#apNote'))), 'Application denied.', refresh));
  });
}

// ---------- One night: edit, cancel, tables, bookings ----------

async function loadNightPicker($w) {
  const occurrences = await call(listUpcomingOccurrences, { weeks: 12 });
  $w('#nightDropdown').options = occurrences.map((o) => ({
    label: `${fmtDate(o.startsAt)}: ${o.title}${o.status === 'cancelled' ? ' (cancelled)' : ''}`,
    value: o._id,
  }));
  if (state.nightId && occurrences.some((o) => o._id === state.nightId)) {
    $w('#nightDropdown').value = state.nightId;
  }
}

async function loadNight($w) {
  if (!state.nightId) return;
  const night = await call(getOccurrenceAdminView, state.nightId);
  state.night = night;
  const occ = night.occurrence;
  $w('#nightWhen').text = `${fmtWhen(occ.startsAt, occ.endsAt)}${occ.status === 'cancelled' ? ` · CANCELLED: ${occ.cancelReason}` : ''}`;
  $w('#nightTitle').value = occ.title || '';
  $w('#nightVenue').value = occ.venue || '';
  $w('#nightDescription').value = occ.description || '';

  setRepeater($w('#adminTablesRepeater'), night.tables.map((t) => ({ ...t, _id: rid(t._id), id: t._id })));

  const claimed = night.tables.filter((t) => t.status === 'claimed');
  $w('#abTableDropdown').options = claimed.map((t) => ({ label: `${t.name}: ${t.gameTitle}`, value: t._id }));
  const bookings = night.tables.flatMap((t) => t.roster.map((b) => ({ ...b, tableName: t.name })));
  $w('#rbBookingDropdown').options = bookings.map((b) => ({ label: `${b.tableName} seat ${b.seatNumber}: ${b.playerName} (${b.email})`, value: b.bookingId }));
  await $w('#nightBox').expand();
}

function wireNight($w) {
  const refresh = () => Promise.all([loadNight($w), loadNightPicker($w)]);

  $w('#nightDropdown').onChange(async () => {
    state.nightId = $w('#nightDropdown').value;
    try {
      await loadNight($w);
    } catch (err) {
      report($w, err.message, true);
    }
  });

  $w('#nightSave').onClick(() => action($w, $w('#nightSave'), 'Saving…', () => call(editOccurrence, state.nightId, {
    title: inputValue($w('#nightTitle')),
    venue: inputValue($w('#nightVenue')),
    description: inputValue($w('#nightDescription')),
  }), 'Event details saved. Future series edits will skip this date.', refresh));

  onConfirmedClick($w('#nightCancelButton'), 'Tap again to cancel this night', () => action($w, $w('#nightCancelButton'), 'Cancelling…',
    () => call(cancelOccurrence, state.nightId, inputValue($w('#nightCancelReason'))),
    (r) => `Event cancelled. ${r.claimsEnded} table(s) and ${r.playersRemoved} player seat(s) released.`, refresh));

  $w('#adminTablesRepeater').onItemReady(($item, t) => {
    $item('#atName').text = t.name;
    $item('#atStatus').text = t.status === 'open' ? 'Open (no DM)'
      : t.status === 'held' ? `Pending claim by ${t.claim ? t.claim.dmDisplayName : 'a DM'}`
        : `${t.gameTitle} · DM ${t.dmDisplayName} · ${t.seatsTaken}/${t.playerCap} seated`;
    setText($item('#atRoster'), t.roster.map((b) => `${b.seatNumber}. ${b.playerName} <${b.email}>`).join('\n'));
    $item('#atMaxSeats').value = String(t.maxSeats);

    $item('#atSave').onClick(() => action($w, $item('#atSave'), 'Saving…',
      () => call(editTable, t.id, { maxSeats: Number(inputValue($item('#atMaxSeats'))) }), `${t.name} updated.`, refresh));

    const releaseBtn = $item('#atRelease');
    if (t.claim) releaseBtn.expand(); else releaseBtn.collapse();
    onConfirmedClick(releaseBtn, 'Tap again to release', () => action($w, releaseBtn, 'Releasing…',
      () => call(adminReleaseClaim, t.claim.claimId, inputValue($item('#atReason'))),
      (r) => `${t.name} released. ${r.playersRemoved} player(s) removed.`, refresh));

    const removeBtn = $item('#atRemove');
    if (t.status === 'open') removeBtn.expand(); else removeBtn.collapse();
    onConfirmedClick(removeBtn, 'Tap again to remove', () => action($w, removeBtn, 'Removing…',
      () => call(removeTable, t.id), `${t.name} removed.`, refresh));
  });

  $w('#addTableButton').onClick(() => action($w, $w('#addTableButton'), 'Adding…', async () => {
    const result = await call(addTable, state.nightId, { name: inputValue($w('#addTableName')), maxSeats: Number(inputValue($w('#addTableSeats'))) });
    clearInputs($w('#addTableName'));
    return result;
  }, (t) => `${t.name} added.`, refresh));

  $w('#abSubmit').onClick(() => action($w, $w('#abSubmit'), 'Adding…', async () => {
    const result = await call(adminAddBooking, $w('#abTableDropdown').value, {
      playerName: inputValue($w('#abName')),
      email: inputValue($w('#abEmail')),
    }, { allowOverCap: $w('#abOverCap').checked === true });
    clearInputs($w('#abName'), $w('#abEmail'));
    return result;
  }, (r) => `Player added to seat ${r.seatNumber}. Their manage link: /my-bookings?token=${r.manageToken}`, refresh));

  onConfirmedClick($w('#rbRemove'), 'Tap again to remove', () => action($w, $w('#rbRemove'), 'Removing…',
    () => call(adminRemoveBooking, $w('#rbBookingDropdown').value, inputValue($w('#rbReason'))), 'Booking removed.', refresh));
}

// ---------- DMs ----------

async function loadDms($w) {
  const dms = await call(listDms);
  setRepeater($w('#dmsRepeater'), dms.map((d) => ({ ...d, _id: rid(d.memberId), id: d.memberId })));
  setText($w('#dmsEmpty'), dms.length ? '' : 'No DMs approved through applications yet.');
}

function wireDms($w) {
  $w('#dmsRepeater').onItemReady(($item, d) => {
    $item('#dmName').text = d.displayName;
    $item('#dmSince').text = d.approvedAt ? `DM since ${fmtDate(d.approvedAt)}` : '';
    const btn = $item('#dmRevoke');
    onConfirmedClick(btn, 'Tap again to remove DM role', () => action($w, btn, 'Removing…',
      () => call(revokeDm, d.id, inputValue($item('#dmRevokeReason'))), `${d.displayName} is no longer a DM.`, () => loadDms($w)));
  });
}
