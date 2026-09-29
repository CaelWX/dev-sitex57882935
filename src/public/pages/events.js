// Events list page. Element IDs are listed in docs/ui-elements.md.
//
// Hook it up from the page's own code file:
//   import { initEventsPage } from 'public/pages/events.js';
//   $w.onReady(() => initEventsPage($w));

import wixLocationFrontend from 'wix-location-frontend';
import { listUpcomingOccurrences } from 'backend/events.web';
import { rid, setRepeater, fmtWhen, call, setText } from 'public/ui.js';

export const EVENT_PAGE_PATH = '/event';

function seatsSummary(occ) {
  if (occ.status === 'cancelled') return `Cancelled${occ.cancelReason ? `: ${occ.cancelReason}` : ''}`;
  const parts = [];
  parts.push(occ.openSeats === 1 ? '1 open seat' : `${occ.openSeats} open seats`);
  if (occ.runningTables) parts.push(occ.runningTables === 1 ? '1 game' : `${occ.runningTables} games`);
  if (occ.openTables) parts.push(occ.openTables === 1 ? '1 table needs a DM' : `${occ.openTables} tables need a DM`);
  return parts.join(' · ');
}

export function initEventsPage($w) {
  setText($w('#eventsError'), '');
  setText($w('#eventsEmpty'), '');

  $w('#eventsRepeater').onItemReady(($item, occ) => {
    $item('#evDate').text = fmtWhen(occ.startsAt, occ.endsAt);
    $item('#evTitle').text = occ.title || 'Game night';
    setText($item('#evVenue'), occ.venue);
    $item('#evSeats').text = seatsSummary(occ);
    $item('#evViewButton').label = occ.status === 'cancelled' ? 'Details' : 'View tables';
    $item('#evViewButton').onClick(() => {
      wixLocationFrontend.to(`${EVENT_PAGE_PATH}?id=${encodeURIComponent(occ.id)}`);
    });
  });

  load($w);
}

async function load($w) {
  try {
    const occurrences = await call(listUpcomingOccurrences, {});
    setRepeater($w('#eventsRepeater'), occurrences.map((o) => ({ ...o, _id: rid(o._id), id: o._id })));
    if (occurrences.length) $w('#eventsRepeater').expand(); else $w('#eventsRepeater').collapse();
    setText($w('#eventsEmpty'), occurrences.length ? '' : 'No upcoming events yet. Check back soon!');
  } catch (err) {
    setText($w('#eventsError'), err.message);
  }
}
