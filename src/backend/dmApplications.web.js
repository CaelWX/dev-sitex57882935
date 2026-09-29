// Members apply to become DMs; Admins approve in admin.web.js.

import { Permissions, webMethod } from 'wix-web-module';
import { COLLECTIONS, DM_APPLICATION_STATUS } from './data/constants.js';
import { getOrFail, insert, patch, query, find } from './lib/db.js';
import { ERR, fail, handled } from './lib/errors.js';
import * as v from './lib/validate.js';
import { requireMember } from './lib/auth.js';
import { audit } from './lib/audit.js';

function publicApplication(a) {
  if (!a) return null;
  return {
    _id: a._id,
    status: a.status,
    experience: a.experience,
    systems: a.systems,
    notes: a.notes,
    decisionReason: a.decisionReason || '',
    submittedAt: a._createdDate,
  };
}

async function latestApplication(memberId) {
  const [latest] = await find(query(COLLECTIONS.DM_APPLICATIONS).eq('memberId', memberId).descending('_createdDate'), 1);
  return latest || null;
}

// `input`: { experience, systems, notes }
export const applyForDm = webMethod(Permissions.SiteMember, handled(async (input) => {
  const caller = await requireMember();
  if (caller.isDM) fail(ERR.CONFLICT, 'You are already a DM.');
  const latest = await latestApplication(caller.memberId);
  if (latest && latest.status === DM_APPLICATION_STATUS.PENDING) fail(ERR.CONFLICT, 'Your application is already waiting for review.');

  const src = input || {};
  const app = await insert(COLLECTIONS.DM_APPLICATIONS, {
    memberId: caller.memberId,
    displayName: caller.displayName,
    experience: v.text(src.experience, 'Experience', { required: true, max: 2000 }),
    systems: v.text(src.systems, 'Systems you run', { required: true, max: 500 }),
    notes: v.text(src.notes, 'Notes', { max: 1000 }),
    status: DM_APPLICATION_STATUS.PENDING,
  });
  await audit('dm_application.submitted', {
    actorType: 'player', actorId: caller.memberId, entityType: 'DMApplications', entityId: app._id,
  });
  return publicApplication(app);
}));

export const getMyDmApplication = webMethod(Permissions.SiteMember, handled(async () => {
  const caller = await requireMember();
  return { isDM: caller.isDM, application: publicApplication(await latestApplication(caller.memberId)) };
}));

export const withdrawDmApplication = webMethod(Permissions.SiteMember, handled(async (applicationId) => {
  const caller = await requireMember();
  const app = await getOrFail(COLLECTIONS.DM_APPLICATIONS, v.id(applicationId, 'Application'), 'That application could not be found.');
  if (app.memberId !== caller.memberId) fail(ERR.FORBIDDEN, 'That application belongs to someone else.');
  if (app.status !== DM_APPLICATION_STATUS.PENDING) fail(ERR.NOT_OPEN, 'Only pending applications can be withdrawn.');
  await patch(COLLECTIONS.DM_APPLICATIONS, app._id, { status: DM_APPLICATION_STATUS.WITHDRAWN });
  return { withdrawn: true };
}));
