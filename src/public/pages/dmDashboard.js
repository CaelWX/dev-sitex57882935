// DM dashboard (/dm). Members who aren't DMs see the application form instead.
// Element IDs are in docs/ui-elements.md.
//
//   import { initDmDashboardPage } from 'public/pages/dmDashboard.js';
//   $w.onReady(() => initDmDashboardPage($w));

import { authentication } from 'wix-members-frontend';
import { getMyDmDashboard, giveUpClaim, updateClaimDetails } from 'backend/claims.web';
import { getMyDmApplication, applyForDm, withdrawDmApplication } from 'backend/dmApplications.web';
import {
  rid, setRepeater, fmtWhen, call, setText, withBusy, onConfirmedClick, inputValue, clearInputs,
} from 'public/ui.js';

const state = { application: null, editing: null, releasing: null };

const STATUS_LABEL = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  release_requested: 'Release requested (Admin reviewing)',
};

function tableLabel(row) {
  const table = row.table ? row.table.name : 'Table';
  return row.occurrence ? `${table} · ${row.occurrence.title}` : table;
}

export function initDmDashboardPage($w) {
  ['#applyBox', '#dmBox', '#editBox', '#releaseBox', '#dmLoginBox'].forEach((id) => $w(id).collapse());
  setText($w('#dmError'), '');

  $w('#dmLoginButton').onClick(() => {
    authentication.promptLogin({ mode: 'login', modal: true })
      .then(() => load($w))
      .catch(() => {});
  });
  wireApplication($w);
  wireRepeaters($w);
  wireEditForm($w);
  wireReleaseForm($w);
  load($w);
}

async function load($w) {
  setText($w('#dmError'), '');
  try {
    const { isDM, application } = await call(getMyDmApplication);
    $w('#dmLoginBox').collapse();
    if (!isDM) {
      state.application = application;
      renderApplication($w);
      $w('#dmBox').collapse();
      await $w('#applyBox').expand();
      return;
    }
    $w('#applyBox').collapse();
    await loadDashboard($w);
    await $w('#dmBox').expand();
  } catch (err) {
    if (err.code === 'NOT_LOGGED_IN') {
      $w('#dmLoginBox').expand();
      return;
    }
    setText($w('#dmError'), err.message);
  }
}

// ---------- Application (non-DMs) ----------

function renderApplication($w) {
  const app = state.application;
  const pending = app && app.status === 'pending';
  let status = '';
  if (pending) status = 'Your application is waiting for review.';
  else if (app && app.status === 'denied') status = `Your last application was not approved.${app.decisionReason ? ` ${app.decisionReason}` : ''} You can apply again.`;
  else if (app && app.status === 'revoked') status = 'Your DM access was removed. Contact the organizers if you think this is a mistake.';
  setText($w('#applyStatus'), status);

  if (pending) {
    $w('#applyForm').collapse();
    $w('#applyWithdraw').expand();
  } else {
    $w('#applyForm').expand();
    $w('#applyWithdraw').collapse();
  }
}

function wireApplication($w) {
  $w('#applySubmit').onClick(() => withBusy($w('#applySubmit'), 'Sending…', async () => {
    try {
      state.application = await call(applyForDm, {
        experience: inputValue($w('#applyExperience')),
        systems: inputValue($w('#applySystems')),
        notes: inputValue($w('#applyNotes')),
      });
      clearInputs($w('#applyExperience'), $w('#applySystems'), $w('#applyNotes'));
      renderApplication($w);
    } catch (err) {
      setText($w('#applyStatus'), err.message);
    }
  }));
  onConfirmedClick($w('#applyWithdraw'), 'Tap again to withdraw', () => withBusy($w('#applyWithdraw'), 'Withdrawing…', async () => {
    try {
      await call(withdrawDmApplication, state.application._id);
      await load($w);
    } catch (err) {
      setText($w('#applyStatus'), err.message);
    }
  }));
}

// ---------- DM dashboard ----------

async function loadDashboard($w) {
  const { pending, active } = await call(getMyDmDashboard);
  const toRows = (rows) => rows.map((r) => ({ ...r, _id: rid(r.claimId), id: r.claimId }));
  setRepeater($w('#pendingRepeater'), toRows(pending));
  setRepeater($w('#activeRepeater'), toRows(active));
  setText($w('#pendingEmpty'), pending.length ? '' : 'No claims awaiting approval.');
  setText($w('#activeEmpty'), active.length ? '' : 'No upcoming tables yet. Claim one from an event page.');
  if (pending.length) $w('#pendingRepeater').expand(); else $w('#pendingRepeater').collapse();
  if (active.length) $w('#activeRepeater').expand(); else $w('#activeRepeater').collapse();
}

function wireRepeaters($w) {
  $w('#pendingRepeater').onItemReady(($item, row) => {
    $item('#pWhen').text = row.occurrence ? fmtWhen(row.occurrence.startsAt, row.occurrence.endsAt) : '';
    $item('#pTable').text = tableLabel(row);
    $item('#pGame').text = `${row.gameTitle} (${row.system}) · up to ${row.playerCap} players`;
    const btn = $item('#pWithdraw');
    onConfirmedClick(btn, 'Tap again to withdraw', () => withBusy(btn, 'Withdrawing…', async () => {
      try {
        await call(giveUpClaim, row.id, '');
        await loadDashboard($w);
      } catch (err) {
        setText($w('#dmError'), err.message);
      }
    }));
    $item('#pEdit').onClick(() => openEdit($w, row));
  });

  $w('#activeRepeater').onItemReady(($item, row) => {
    $item('#aWhen').text = row.occurrence ? fmtWhen(row.occurrence.startsAt, row.occurrence.endsAt) : '';
    $item('#aTable').text = tableLabel(row);
    $item('#aGame').text = `${row.gameTitle} (${row.system})`;
    $item('#aStatus').text = STATUS_LABEL[row.status] || row.status;
    $item('#aSeats').text = `${row.roster.length} of ${row.playerCap} seats filled`;
    setText($item('#aRoster'), row.roster.length
      ? row.roster.map((p) => `${p.seatNumber}. ${p.playerName}`).join('\n')
      : 'No players yet.');
    $item('#aEditButton').onClick(() => openEdit($w, row));
    const releaseBtn = $item('#aReleaseButton');
    if (row.status === 'release_requested') releaseBtn.collapse(); else releaseBtn.expand();
    releaseBtn.onClick(() => openRelease($w, row));
  });
}

// ---------- Edit game details ----------

function openEdit($w, row) {
  state.editing = row;
  $w('#releaseBox').collapse();
  $w('#editLabel').text = `Edit ${tableLabel(row)}`;
  $w('#editGameTitle').value = row.gameTitle || '';
  $w('#editSystem').value = row.system || '';
  $w('#editPlayerCap').value = String(row.playerCap || '');
  $w('#editDescription').value = row.description || '';
  $w('#editContentNotes').value = row.contentNotes || '';
  setText($w('#editMessage'), '');
  $w('#editBox').expand().then(() => $w('#editBox').scrollTo());
}

function wireEditForm($w) {
  $w('#editCancel').onClick(() => $w('#editBox').collapse());
  $w('#editSave').onClick(() => withBusy($w('#editSave'), 'Saving…', async () => {
    try {
      await call(updateClaimDetails, state.editing.id, {
        gameTitle: inputValue($w('#editGameTitle')),
        system: inputValue($w('#editSystem')),
        playerCap: Number(inputValue($w('#editPlayerCap'))),
        description: inputValue($w('#editDescription')),
        contentNotes: inputValue($w('#editContentNotes')),
      });
      $w('#editBox').collapse();
      await loadDashboard($w);
    } catch (err) {
      setText($w('#editMessage'), err.message);
    }
  }));
}

// ---------- Release an approved table ----------

function openRelease($w, row) {
  state.releasing = row;
  $w('#editBox').collapse();
  const hoursLeft = row.occurrence ? (new Date(row.occurrence.startsAt) - new Date()) / 3600000 : 0;
  $w('#releaseLabel').text = hoursLeft > 24
    ? `Release ${tableLabel(row)}? ${row.roster.length ? `The ${row.roster.length} seated player(s) will lose their seats.` : ''}`
    : `It's less than 24 hours before the event, so an Admin must approve releasing ${tableLabel(row)}. Your players stay seated until then.`;
  $w('#releaseReason').value = '';
  setText($w('#releaseMessage'), '');
  $w('#releaseBox').expand().then(() => $w('#releaseBox').scrollTo());
}

function wireReleaseForm($w) {
  $w('#releaseCancel').onClick(() => $w('#releaseBox').collapse());
  $w('#releaseConfirm').onClick(() => withBusy($w('#releaseConfirm'), 'Sending…', async () => {
    try {
      const result = await call(giveUpClaim, state.releasing.id, inputValue($w('#releaseReason')));
      setText($w('#releaseMessage'), result.message || 'Table released.');
      await loadDashboard($w);
      if (!result.message) $w('#releaseBox').collapse();
    } catch (err) {
      setText($w('#releaseMessage'), err.message);
    }
  }));
}
