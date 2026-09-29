// Who is calling? Every web method checks this itself; page code is never trusted.
//
// Wix-specific notes:
// - currentMember.getMember() throws when nobody is logged in, so visitors are handled explicitly.
// - currentMember.getRoles() returns the member's roles plus a role titled "Admin"
//   (ID 00000000-0000-0000-0000-000000000001) for the site owner and admin collaborators.
// - Members APIs are only partly functional in Preview. Test role checks on the published site.

import { currentMember } from 'wix-members-backend';
import { ADMIN_ROLE_ID, ADMIN_ROLE_TITLE, DM_ROLE_TITLE } from '../data/constants.js';
import { ERR, fail } from './errors.js';

const VISITOR = Object.freeze({
  isLoggedIn: false, memberId: null, email: null, displayName: null, isAdmin: false, isDM: false,
});

export async function getCaller() {
  let member;
  try {
    member = await currentMember.getMember({ fieldsets: ['FULL'] });
  } catch (err) {
    return VISITOR;
  }
  if (!member) return VISITOR;

  let roles = [];
  try {
    roles = (await currentMember.getRoles()) || [];
  } catch (err) {
    roles = [];
  }
  const titles = roles.map((r) => String(r.title || r.name || '').toLowerCase());

  const contact = member.contactDetails || {};
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  return {
    isLoggedIn: true,
    memberId: member._id,
    email: (member.loginEmail || '').trim().toLowerCase() || null,
    displayName: (member.profile && member.profile.nickname) || fullName || 'Dungeon Master',
    isAdmin: roles.some((r) => r._id === ADMIN_ROLE_ID) || titles.includes(ADMIN_ROLE_TITLE.toLowerCase()),
    isDM: titles.includes(DM_ROLE_TITLE.toLowerCase()),
  };
}

export async function requireMember() {
  const caller = await getCaller();
  if (!caller.isLoggedIn) fail(ERR.NOT_LOGGED_IN, 'Please log in first.');
  return caller;
}

export async function requireDM() {
  const caller = await requireMember();
  if (!caller.isDM) fail(ERR.FORBIDDEN, 'Only Dungeon Masters can do that. You can apply to become a DM from your dashboard.');
  if (!caller.email) fail(ERR.FORBIDDEN, 'Your account needs a login email before you can claim tables.');
  return caller;
}

export async function requireAdmin() {
  const caller = await requireMember();
  if (!caller.isAdmin) fail(ERR.FORBIDDEN, 'Only site admins can do that.');
  return caller;
}

// Public projection for the page: tells the UI which buttons to show. Not used for enforcement.
export function publicCaller(caller) {
  return {
    isLoggedIn: caller.isLoggedIn,
    memberId: caller.memberId,
    displayName: caller.displayName,
    isAdmin: caller.isAdmin,
    isDM: caller.isDM,
  };
}
