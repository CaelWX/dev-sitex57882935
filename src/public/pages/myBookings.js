// Player "manage my bookings" page (/my-bookings?token=...). No login needed: the private
// token from the booking link identifies the player. Element IDs are in docs/ui-elements.md.
//
//   import { initMyBookingsPage } from 'public/pages/myBookings.js';
//   $w.onReady(() => initMyBookingsPage($w));

import wixLocationFrontend from 'wix-location-frontend';
import { getMyBookings, cancelMyBooking } from 'backend/bookings.web';
import {
  rid, setRepeater, fmtWhen, call, setText, withBusy, onConfirmedClick,
} from 'public/ui.js';

const state = { token: null };

export function initMyBookingsPage($w) {
  state.token = wixLocationFrontend.query.token;
  setText($w('#mbError'), '');
  setText($w('#mbEmpty'), '');
  setText($w('#mbIntro'), '');

  $w('#myBookingsRepeater').onItemReady(($item, b) => {
    $item('#mbWhen').text = b.occurrence ? fmtWhen(b.occurrence.startsAt, b.occurrence.endsAt) : '';
    $item('#mbTitle').text = b.occurrence ? b.occurrence.title : '';
    $item('#mbTable').text = b.table ? `${b.table.name}: ${b.table.gameTitle || ''}${b.table.dmDisplayName ? ` (DM ${b.table.dmDisplayName})` : ''}` : '';
    $item('#mbSeat').text = `Seat ${b.seatNumber} · booked as ${b.playerName}`;
    const cancelBtn = $item('#mbCancelButton');
    onConfirmedClick(cancelBtn, 'Tap again to cancel', () => withBusy(cancelBtn, 'Cancelling…', async () => {
      try {
        await call(cancelMyBooking, state.token, b.id);
        await load($w);
      } catch (err) {
        setText($w('#mbError'), err.message);
      }
    }));
  });

  if (!state.token) {
    setText($w('#mbError'), 'Open this page from the link you got when you booked.');
    $w('#myBookingsRepeater').collapse();
    return;
  }
  load($w);
}

async function load($w) {
  setText($w('#mbError'), '');
  try {
    const { email, bookings } = await call(getMyBookings, state.token);
    setText($w('#mbIntro'), `Upcoming seats booked with ${email}`);
    setRepeater($w('#myBookingsRepeater'), bookings.map((b) => ({ ...b, _id: rid(b.bookingId), id: b.bookingId })));
    if (bookings.length) $w('#myBookingsRepeater').expand(); else $w('#myBookingsRepeater').collapse();
    setText($w('#mbEmpty'), bookings.length ? '' : 'You have no upcoming seats.');
  } catch (err) {
    $w('#myBookingsRepeater').collapse();
    setText($w('#mbError'), err.message);
  }
}
