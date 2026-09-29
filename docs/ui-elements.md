# Booking pages: Editor setup

Velo page code can't create page elements, so each page is built in the Editor and the code finds
elements by ID. For each page:

1. Add the page in the Editor with the **URL slug** shown.
2. Add the elements below and set each one's **ID** in the Properties panel (IDs are case-sensitive).
3. Paste the two-line hook into the page's code panel (replace the empty `$w.onReady`).

Layout is up to you. For mobile, stack elements vertically inside each repeater item and box.
Elements marked *(collapsed)* should have **Collapsed on load** ticked, so they don't flash before
the code runs. Any text element the code fills can hold placeholder text; it gets replaced.

---

## 1. Events: slug `/events`

```js
import { initEventsPage } from 'public/pages/events.js';
$w.onReady(() => initEventsPage($w));
```

| ID | Type | Purpose |
|---|---|---|
| `eventsRepeater` | Repeater | One item per upcoming night |
| ↳ `evDate` | Text | Date and time (Denver) |
| ↳ `evTitle` | Text | Event title |
| ↳ `evVenue` | Text | Venue |
| ↳ `evSeats` | Text | "12 open seats · 3 games · 1 table needs a DM" |
| ↳ `evViewButton` | Button | Goes to the event page |
| `eventsEmpty` | Text | Shown when nothing is scheduled |
| `eventsError` | Text | Error message (style it red) |

## 2. Event detail: slug `/event`

The events list links here as `/event?id=…`. If you use a different slug, change `EVENT_PAGE_PATH`
in `public/pages/events.js`.

```js
import { initEventPage } from 'public/pages/event.js';
$w.onReady(() => initEventPage($w));
```

| ID | Type | Purpose |
|---|---|---|
| `occTitle` | Text | Event title |
| `occWhen` | Text | Date and time |
| `occVenue` | Text | Venue |
| `occDescription` | Text | Description |
| `occNotice` | Text | Cancelled / started / "you're DMing tonight" notice |
| `pageError` | Text | Error message |
| `tablesRepeater` | Repeater | One item per table |
| ↳ `tName` | Text | Table name |
| ↳ `tStatus` | Text | "Looking for a DM" / "3 of 5 seats left" / "Full" |
| ↳ `tGame` | Text | Game title |
| ↳ `tSystem` | Text | System / edition |
| ↳ `tDm` | Text | "DM: name" |
| ↳ `tDescription` | Text | Game description |
| ↳ `tContentNotes` | Text | Content notes |
| ↳ `tBookButton` | Button | "Join this table" (players) |
| ↳ `tClaimButton` | Button | "Claim this table" (DMs only; hidden for others) |
| `bookBox` | Box *(collapsed)* | Booking form |
| ↳ `bookTableLabel` | Text | Which table they're joining |
| ↳ `bookName` | Text Input | Player name |
| ↳ `bookEmail` | Text Input (type: email) | Player email |
| ↳ `bookSubmit` | Button | Book |
| ↳ `bookCancel` | Button | Close the form |
| ↳ `bookMessage` | Text | Error message |
| `bookSuccessBox` | Box *(collapsed)* | Shown after booking |
| ↳ `bookSuccessText` | Text | Confirmation |
| ↳ `manageLinkButton` | Button | "Manage my booking" (link set by code) |
| `claimBox` | Box *(collapsed)* | DM claim form |
| ↳ `claimTableLabel` | Text | Which table |
| ↳ `claimGameTitle` | Text Input | Game title |
| ↳ `claimSystem` | Text Input | System / edition |
| ↳ `claimPlayerCap` | Text Input (type: number) | Player cap |
| ↳ `claimDescription` | Text Box | Description |
| ↳ `claimContentNotes` | Text Box | Content notes |
| ↳ `claimMoreDates` | Checkbox Group *(collapsed)* | "Also claim this table on:" other dates |
| ↳ `claimSubmit` | Button | Submit claim |
| ↳ `claimCancel` | Button | Close the form |
| ↳ `claimMessage` | Text | Result or error |

## 3. My bookings: slug `/my-bookings`

Players reach this from their booking link (`/my-bookings?token=…`). Hide it from the site menu.
If you change the slug, update `MY_BOOKINGS_PATH` in `public/pages/event.js`.

```js
import { initMyBookingsPage } from 'public/pages/myBookings.js';
$w.onReady(() => initMyBookingsPage($w));
```

| ID | Type | Purpose |
|---|---|---|
| `mbIntro` | Text | "Upcoming seats booked with …" |
| `mbError` | Text | Error message |
| `mbEmpty` | Text | No bookings message |
| `myBookingsRepeater` | Repeater | One item per booking |
| ↳ `mbWhen` | Text | Date and time |
| ↳ `mbTitle` | Text | Event title |
| ↳ `mbTable` | Text | Table, game and DM |
| ↳ `mbSeat` | Text | Seat number and name |
| ↳ `mbCancelButton` | Button | Cancel (tap twice) |

## 4. DM dashboard: slug `/dm`

Set the page to **Members only** in Page Permissions.

```js
import { initDmDashboardPage } from 'public/pages/dmDashboard.js';
$w.onReady(() => initDmDashboardPage($w));
```

| ID | Type | Purpose |
|---|---|---|
| `dmError` | Text | Error message |
| `dmLoginBox` | Box *(collapsed)* | Shown if not logged in |
| ↳ `dmLoginButton` | Button | Log in |
| `applyBox` | Box *(collapsed)* | For members who aren't DMs yet |
| ↳ `applyStatus` | Text | Application status / errors |
| ↳ `applyForm` | Box | Wraps the application inputs |
| ↳↳ `applyExperience` | Text Box | DMing experience |
| ↳↳ `applySystems` | Text Input | Systems they run |
| ↳↳ `applyNotes` | Text Box | Anything else |
| ↳↳ `applySubmit` | Button | Apply |
| ↳ `applyWithdraw` | Button *(collapsed)* | Withdraw pending application |
| `dmBox` | Box *(collapsed)* | The dashboard itself |
| ↳ `pendingRepeater` | Repeater | Claims awaiting approval |
| ↳↳ `pWhen` | Text | Date |
| ↳↳ `pTable` | Text | Table and event |
| ↳↳ `pGame` | Text | Game, system, cap |
| ↳↳ `pEdit` | Button | Edit details |
| ↳↳ `pWithdraw` | Button | Withdraw (tap twice) |
| ↳ `pendingEmpty` | Text | Empty message |
| ↳ `activeRepeater` | Repeater | Approved tables |
| ↳↳ `aWhen` | Text | Date |
| ↳↳ `aTable` | Text | Table and event |
| ↳↳ `aGame` | Text | Game and system |
| ↳↳ `aStatus` | Text | Approved / release requested |
| ↳↳ `aSeats` | Text | "3 of 5 seats filled" |
| ↳↳ `aRoster` | Text | Player display names, one per line |
| ↳↳ `aEditButton` | Button | Edit details |
| ↳↳ `aReleaseButton` | Button | Release table |
| ↳ `activeEmpty` | Text | Empty message |
| ↳ `editBox` | Box *(collapsed)* | Edit form |
| ↳↳ `editLabel` | Text | Which table |
| ↳↳ `editGameTitle` | Text Input | |
| ↳↳ `editSystem` | Text Input | |
| ↳↳ `editPlayerCap` | Text Input (type: number) | |
| ↳↳ `editDescription` | Text Box | |
| ↳↳ `editContentNotes` | Text Box | |
| ↳↳ `editSave` | Button | Save |
| ↳↳ `editCancel` | Button | Close |
| ↳↳ `editMessage` | Text | Error message |
| ↳ `releaseBox` | Box *(collapsed)* | Release confirmation |
| ↳↳ `releaseLabel` | Text | Explains what will happen |
| ↳↳ `releaseReason` | Text Input | Optional reason |
| ↳↳ `releaseConfirm` | Button | Release / request release |
| ↳↳ `releaseCancel` | Button | Close |
| ↳↳ `releaseMessage` | Text | Result or error |

## 5. Admin dashboard: slug `/admin`

Set Page Permissions to **Members only** and hide it from the menu. The backend only allows site
owners and admin collaborators, so anyone else sees an error. Open it on the **published** site
while logged in (role checks don't fully work in Preview).

```js
import { initAdminDashboardPage } from 'public/pages/adminDashboard.js';
$w.onReady(() => initAdminDashboardPage($w));
```

**Messages**

| ID | Type | Purpose |
|---|---|---|
| `adminMessage` | Text | Last action's result |
| `adminError` | Text | Last action's error (red) |

**Queue**

| ID | Type | Purpose |
|---|---|---|
| `claimsRepeater` | Repeater | Pending table claims |
| ↳ `cqWhen`, `cqTable`, `cqDm`, `cqGame`, `cqDetails` | Text | Claim details |
| ↳ `cqReason` | Text Input | Optional reason (used when denying) |
| ↳ `cqApprove`, `cqDeny` | Button | |
| `claimsEmpty` | Text | Empty message |
| `releaseRepeater` | Repeater | Late release requests (inside 24h) |
| ↳ `rqWhen`, `rqTable`, `rqDm`, `rqReason` | Text | Request details |
| ↳ `rqNote` | Text Input | Optional note |
| ↳ `rqApprove`, `rqDeny` | Button | |
| `releaseEmpty` | Text | Empty message |
| `appsRepeater` | Repeater | DM applications |
| ↳ `apName`, `apExperience`, `apSystems`, `apNotes` | Text | Application |
| ↳ `apNote` | Text Input | Optional reason |
| ↳ `apApprove`, `apDeny` | Button | |
| `appsEmpty` | Text | Empty message |

**Manage a night**

| ID | Type | Purpose |
|---|---|---|
| `nightDropdown` | Dropdown | Pick an upcoming night |
| `nightBox` | Box *(collapsed)* | Everything below goes inside |
| ↳ `nightWhen` | Text | Date/time and cancelled status |
| ↳ `nightTitle`, `nightVenue` | Text Input | Edit details |
| ↳ `nightDescription` | Text Box | Edit details |
| ↳ `nightSave` | Button | Save details |
| ↳ `nightCancelReason` | Text Input | Required to cancel |
| ↳ `nightCancelButton` | Button | Cancel this night (tap twice) |
| ↳ `adminTablesRepeater` | Repeater | One item per table |
| ↳↳ `atName`, `atStatus`, `atRoster` | Text | Table, status, players with emails |
| ↳↳ `atMaxSeats` | Text Input (type: number) | Seats at the table |
| ↳↳ `atSave` | Button | Save seats |
| ↳↳ `atReason` | Text Input | Reason for releasing |
| ↳↳ `atRelease` | Button | Release the DM's claim (tap twice) |
| ↳↳ `atRemove` | Button | Remove an open table (tap twice) |
| ↳ `addTableName` | Text Input | New table name (optional) |
| ↳ `addTableSeats` | Text Input (type: number) | New table seats |
| ↳ `addTableButton` | Button | Add table |
| ↳ `abTableDropdown` | Dropdown | Table to add a player to |
| ↳ `abName`, `abEmail` | Text Input | Player |
| ↳ `abOverCap` | Checkbox | Allow going over the DM's cap |
| ↳ `abSubmit` | Button | Add player |
| ↳ `rbBookingDropdown` | Dropdown | Booking to remove |
| ↳ `rbReason` | Text Input | Reason |
| ↳ `rbRemove` | Button | Remove booking (tap twice) |

**DMs**

| ID | Type | Purpose |
|---|---|---|
| `dmsRepeater` | Repeater | DMs approved through applications |
| ↳ `dmName`, `dmSince` | Text | |
| ↳ `dmRevokeReason` | Text Input | Reason |
| ↳ `dmRevoke` | Button | Remove DM role (tap twice) |
| `dmsEmpty` | Text | Empty message |

Series creation and occurrence generation get their own section in stage 4.
