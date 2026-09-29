// Occurrence detail page (/event?id=...). Element IDs are listed in docs/ui-elements.md.
//
// Hook it up from the page's own code file:
//   import { initEventPage } from 'public/pages/event.js';
//   $w.onReady(() => initEventPage($w));
//
// The page only decides which buttons to show. Every rule (roles, capacity, one seat per
// night, DMs not playing at their own night) is enforced again by the backend.

import wixLocationFrontend from 'wix-location-frontend';
import { getOccurrenceDetail } from 'backend/events.web';
import { bookSeat } from 'backend/bookings.web';
import { submitClaim, submitClaims, listSameTableOtherDates } from 'backend/claims.web';
import {
  rid, setRepeater, fmtWhen, fmtDate, call, setText, withBusy, inputValue, clearInputs,
} from 'public/ui.js';

export const MY_BOOKINGS_PATH = '/my-bookings';

const state = { occurrenceId: null, detail: null, activeTable: null };

function isBookable(detail) {
  const occ = detail.occurrence;
  return occ.status !== 'cancelled' && new Date(occ.startsAt) > new Date();
}

function statusLine(t) {
  if (t.status === 'open') return 'Looking for a DM';
  if (t.status === 'held') return 'DM awaiting approval';
  if (t.seatsLeft <= 0) return `Full (${t.playerCap} players)`;
  return `${t.seatsLeft} of ${t.playerCap} seats left`;
}

function renderTable($w, $item, t) {
  const { viewer } = state.detail;
  const bookable = isBookable(state.detail);
  const claimed = t.status === 'claimed';

  $item('#tName').text = t.name || `Table ${t.tableNumber}`;
  $item('#tStatus').text = statusLine(t);
  setText($item('#tGame'), claimed ? t.gameTitle : '');
  setText($item('#tSystem'), claimed ? t.system : '');
  setText($item('#tDm'), claimed ? `DM: ${t.dmDisplayName}` : '');
  setText($item('#tDescription'), claimed ? t.description : '');
  setText($item('#tContentNotes'), claimed && t.contentNotes ? `Content notes: ${t.contentNotes}` : '');

  // Players (including DMs playing elsewhere) can book claimed tables with free seats.
  // A DM running a table tonight can't also book a seat.
  const dmTonight = viewer.myTableIds.length > 0;
  const bookBtn = $item('#tBookButton');
  if (bookable && claimed && !dmTonight) {
    bookBtn.expand();
    if (t.seatsLeft > 0) {
      bookBtn.label = 'Join this table';
      bookBtn.enable();
    } else {
      bookBtn.label = 'Full'; // waitlist arrives in stage 5
      bookBtn.disable();
    }
  } else {
    bookBtn.collapse();
  }
  bookBtn.onClick(() => openBookForm($w, t));

  const claimBtn = $item('#tClaimButton');
  if (bookable && viewer.canClaim && t.status === 'open') claimBtn.expand(); else claimBtn.collapse();
  claimBtn.onClick(() => openClaimForm($w, t));
}

export function initEventPage($w) {
  state.occurrenceId = wixLocationFrontend.query.id;
  $w('#bookBox').collapse();
  $w('#claimBox').collapse();
  $w('#bookSuccessBox').collapse();
  setText($w('#pageError'), '');
  setText($w('#occNotice'), '');

  $w('#tablesRepeater').onItemReady(($item, t) => renderTable($w, $item, t));
  wireBookForm($w);
  wireClaimForm($w);

  if (!state.occurrenceId) {
    setText($w('#pageError'), 'No event selected. Go back to the events list and choose one.');
    return;
  }
  load($w);
}

async function load($w) {
  try {
    const detail = await call(getOccurrenceDetail, state.occurrenceId);
    state.detail = detail;
    const occ = detail.occurrence;
    $w('#occTitle').text = occ.title || 'Game night';
    $w('#occWhen').text = fmtWhen(occ.startsAt, occ.endsAt);
    setText($w('#occVenue'), occ.venue);
    setText($w('#occDescription'), occ.description);
    if (occ.status === 'cancelled') {
      setText($w('#occNotice'), `This event has been cancelled.${occ.cancelReason ? ` ${occ.cancelReason}` : ''}`);
    } else if (new Date(occ.startsAt) <= new Date()) {
      setText($w('#occNotice'), 'This event has already started.');
    } else if (detail.viewer.myTableIds.length) {
      setText($w('#occNotice'), 'You are running a table at this event, so you can\'t book a seat as a player.');
    } else {
      setText($w('#occNotice'), '');
    }
    setRepeater($w('#tablesRepeater'), detail.tables.map((t) => ({ ...t, _id: rid(t._id), id: t._id })));
  } catch (err) {
    setText($w('#pageError'), err.message);
  }
}

// ---------- Booking ----------

function openBookForm($w, t) {
  state.activeTable = t;
  $w('#claimBox').collapse();
  $w('#bookSuccessBox').collapse();
  $w('#bookTableLabel').text = `Join ${t.gameTitle} (${t.name})`;
  setText($w('#bookMessage'), '');
  $w('#bookBox').expand().then(() => $w('#bookBox').scrollTo());
}

function wireBookForm($w) {
  $w('#bookCancel').onClick(() => $w('#bookBox').collapse());
  $w('#bookSubmit').onClick(() => withBusy($w('#bookSubmit'), 'Booking…', async () => {
    setText($w('#bookMessage'), '');
    try {
      const result = await call(bookSeat, state.activeTable.id, {
        playerName: inputValue($w('#bookName')),
        email: inputValue($w('#bookEmail')),
      });
      clearInputs($w('#bookName'), $w('#bookEmail'));
      $w('#bookBox').collapse();
      $w('#bookSuccessText').text = `You're in! Seat ${result.seatNumber} at ${result.table.name} for ${result.table.gameTitle}, ${fmtWhen(result.occurrence.startsAt)}.`
        + ' Bookmark the link below. It\'s how you view or cancel your booking.';
      $w('#manageLinkButton').link = `${MY_BOOKINGS_PATH}?token=${result.manageToken}`;
      $w('#manageLinkButton').target = '_self';
      await $w('#bookSuccessBox').expand();
      $w('#bookSuccessBox').scrollTo();
      await load($w);
    } catch (err) {
      setText($w('#bookMessage'), err.message);
    }
  }));
}

// ---------- Claiming (DMs) ----------

async function openClaimForm($w, t) {
  state.activeTable = t;
  $w('#bookBox').collapse();
  $w('#bookSuccessBox').collapse();
  $w('#claimTableLabel').text = `Claim ${t.name} (up to ${t.maxSeats} players)`;
  $w('#claimPlayerCap').value = String(t.maxSeats);
  setText($w('#claimMessage'), '');
  $w('#claimMoreDates').collapse();
  $w('#claimMoreDates').options = [];
  await $w('#claimBox').expand();
  $w('#claimBox').scrollTo();

  try {
    const others = await call(listSameTableOtherDates, t.id);
    if (others.length) {
      $w('#claimMoreDates').options = others.map((o) => ({ label: `${fmtDate(o.occurrence.startsAt)} (${o.tableName})`, value: o.tableId }));
      $w('#claimMoreDates').value = [];
      $w('#claimMoreDates').expand();
    }
  } catch (err) {
    // Optional feature; the single-date claim still works.
    console.warn('Could not load other dates', err);
  }
}

function wireClaimForm($w) {
  $w('#claimCancel').onClick(() => $w('#claimBox').collapse());
  $w('#claimSubmit').onClick(() => withBusy($w('#claimSubmit'), 'Submitting…', async () => {
    setText($w('#claimMessage'), '');
    const details = {
      gameTitle: inputValue($w('#claimGameTitle')),
      system: inputValue($w('#claimSystem')),
      playerCap: Number(inputValue($w('#claimPlayerCap'))),
      description: inputValue($w('#claimDescription')),
      contentNotes: inputValue($w('#claimContentNotes')),
    };
    const extra = ($w('#claimMoreDates').value || []).filter(Boolean);
    try {
      if (!extra.length) {
        await call(submitClaim, state.activeTable.id, details);
        setText($w('#claimMessage'), 'Claim submitted! An Admin will review it. You can track it on your DM dashboard.');
      } else {
        const { results } = await call(submitClaims, [state.activeTable.id, ...extra], details);
        const okCount = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok).map((r) => r.error.message);
        setText($w('#claimMessage'), `${okCount} of ${results.length} claims submitted for review.`
          + (failed.length ? ` Not submitted: ${[...new Set(failed)].join(' ')}` : ''));
      }
      clearInputs($w('#claimGameTitle'), $w('#claimSystem'), $w('#claimDescription'), $w('#claimContentNotes'));
      await load($w);
    } catch (err) {
      setText($w('#claimMessage'), err.message);
    }
  }));
}
