/**
 * Who is in the room.
 *
 * A draft is played by two whole teams, not two lone captains. Everybody on a
 * side joins with the same team code, and the first of them to arrive leads —
 * they are the one who actually picks and bans. If that is the wrong person, the
 * lead can be handed to a teammate, which is quicker than everyone leaving and
 * rejoining in a different order.
 *
 * Nobody's place is tied to their connection. A player is remembered by an id
 * their browser keeps, so somebody whose phone dies comes back as themselves —
 * still on their team, still leading it if they were.
 */

import type { Team } from "../types.js";

export interface Member {
  /** Kept by the player's own browser, so a reconnect is recognised as them. */
  readonly id: string;
  readonly name: string;
  readonly team: Team;
  readonly ready: boolean;
  /** When they first arrived, which is what decides who leads. */
  readonly joinedAt: number;
  /** When they were last connected, so a room can tell a blip from a departure. */
  readonly lastSeenAt: number;
}

export interface Roster {
  readonly members: readonly Member[];
  /** The member leading each side, by id. Null before anybody has arrived. */
  readonly leaders: Readonly<Record<Team, string | null>>;
  /** How many players each side is waiting for. */
  readonly teamSize: number;
}

export function emptyRoster(teamSize: number): Roster {
  return { members: [], leaders: { A: null, B: null }, teamSize };
}

export function teamMembers(roster: Roster, team: Team): readonly Member[] {
  return roster.members.filter((member) => member.team === team);
}

export function findMember(roster: Roster, id: string): Member | undefined {
  return roster.members.find((member) => member.id === id);
}

export function isLeader(roster: Roster, id: string): boolean {
  return roster.leaders.A === id || roster.leaders.B === id;
}

export function leaderOf(roster: Roster, team: Team): Member | undefined {
  const id = roster.leaders[team];
  return id === null ? undefined : findMember(roster, id);
}

/**
 * Adds somebody to a side, or recognises them coming back.
 *
 * The first arrival on a team leads it. A returning player keeps whatever they
 * had, including the lead, so a dropped connection never costs somebody their
 * place mid-draft.
 */
export function join(roster: Roster, member: { id: string; name: string; team: Team }, now: number): Roster {
  const existing = findMember(roster, member.id);
  if (existing !== undefined) {
    // A name can change on the way back in; the team cannot.
    const members = roster.members.map((m) => (m.id === member.id ? { ...m, name: member.name } : m));
    return { ...roster, members };
  }

  const joined: Member = {
    id: member.id,
    name: member.name,
    team: member.team,
    ready: false,
    joinedAt: now,
    lastSeenAt: now,
  };
  const leaders =
    roster.leaders[member.team] === null ? { ...roster.leaders, [member.team]: member.id } : roster.leaders;
  return { ...roster, members: [...roster.members, joined], leaders };
}

/** Removes somebody who has left for good, passing the lead on if it was theirs. */
export function leave(roster: Roster, id: string): Roster {
  const member = findMember(roster, id);
  if (member === undefined) return roster;

  const members = roster.members.filter((m) => m.id !== id);
  if (roster.leaders[member.team] !== id) return { ...roster, members };

  // The longest-serving teammate takes over rather than the seat sitting empty.
  const heir = members.filter((m) => m.team === member.team).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  return { ...roster, members, leaders: { ...roster.leaders, [member.team]: heir?.id ?? null } };
}

/** Notes that these people are connected right now. */
export function touch(roster: Roster, connected: ReadonlySet<string>, now: number): Roster {
  if (connected.size === 0) return roster;
  return {
    ...roster,
    members: roster.members.map((m) => (connected.has(m.id) ? { ...m, lastSeenAt: now } : m)),
  };
}

/**
 * Moves the lead off somebody who has been gone a while.
 *
 * A leader whose phone died should not have to be noticed and clicked around.
 * The wait is long enough that a lift or a dropped signal does not cost them the
 * job, and a teammate can always take over sooner by asking for it.
 */
export function passOnAbandonedLead(
  roster: Roster,
  connected: ReadonlySet<string>,
  now: number,
  graceMs: number,
): Roster | null {
  let next = roster;
  for (const team of ["A", "B"] as const) {
    const id = next.leaders[team];
    if (id === null || connected.has(id)) continue;
    const leader = findMember(next, id);
    if (leader === undefined || now - leader.lastSeenAt < graceMs) continue;

    const heir = next.members
      .filter((m) => m.team === team && connected.has(m.id))
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (heir === undefined) continue;
    next = { ...next, leaders: { ...next.leaders, [team]: heir.id } };
  }
  return next === roster ? null : next;
}

export function setReady(roster: Roster, id: string, ready: boolean): Roster {
  return { ...roster, members: roster.members.map((m) => (m.id === id ? { ...m, ready } : m)) };
}

/** Hands the lead to a teammate. Only a side's own leader may do this. */
export function handOver(roster: Roster, from: string, to: string): Roster | null {
  const giver = findMember(roster, from);
  const taker = findMember(roster, to);
  if (giver === undefined || taker === undefined) return null;
  if (giver.team !== taker.team) return null;
  if (roster.leaders[giver.team] !== from) return null;
  return { ...roster, leaders: { ...roster.leaders, [giver.team]: to } };
}

/**
 * Lets a teammate take the lead when the person holding it is not connected.
 *
 * A captain whose phone died should not be able to strand their team, and since
 * the clock never stops, waiting for them to reappear costs the side the draft.
 * While the leader is present, nobody can take it from them.
 */
export function claimLead(roster: Roster, claimant: string, connected: ReadonlySet<string>): Roster | null {
  const member = findMember(roster, claimant);
  if (member === undefined) return null;
  const current = roster.leaders[member.team];
  if (current === claimant) return null;
  if (current !== null && connected.has(current)) return null;
  return { ...roster, leaders: { ...roster.leaders, [member.team]: claimant } };
}

/** True when both sides have every player they are waiting for. */
export function everyoneHere(roster: Roster): boolean {
  return teamMembers(roster, "A").length >= roster.teamSize && teamMembers(roster, "B").length >= roster.teamSize;
}

/** True when the room is full and every one of them has said they are ready. */
export function everyoneReady(roster: Roster): boolean {
  return everyoneHere(roster) && roster.members.every((member) => member.ready);
}
