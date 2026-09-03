import { describe, expect, it } from "vitest";
import {
  claimLead,
  emptyRoster,
  everyoneHere,
  everyoneReady,
  handOver,
  join,
  leave,
  leaderOf,
  passOnAbandonedLead,
  setReady,
  teamMembers,
  touch,
} from "../src/room/roster.js";
import type { Roster } from "../src/room/roster.js";

const T0 = 1_700_000_000_000;

function withTeams(sizeA: number, sizeB: number, teamSize = 3): Roster {
  let roster = emptyRoster(teamSize);
  for (let i = 0; i < sizeA; i++) roster = join(roster, { id: `a${i}`, name: `A${i}`, team: "A" }, T0 + i);
  for (let i = 0; i < sizeB; i++) roster = join(roster, { id: `b${i}`, name: `B${i}`, team: "B" }, T0 + i);
  return roster;
}

describe("joining", () => {
  it("makes the first person on a side its leader", () => {
    const roster = withTeams(3, 1);
    expect(leaderOf(roster, "A")?.id).toBe("a0");
    expect(leaderOf(roster, "B")?.id).toBe("b0");
  });

  it("puts later arrivals on the team without disturbing the lead", () => {
    const roster = withTeams(3, 0);
    expect(teamMembers(roster, "A").map((m) => m.id)).toEqual(["a0", "a1", "a2"]);
    expect(leaderOf(roster, "A")?.id).toBe("a0");
  });

  it("recognises somebody coming back rather than seating them twice", () => {
    let roster = withTeams(2, 0);
    roster = join(roster, { id: "a0", name: "A0", team: "A" }, T0 + 500);
    expect(teamMembers(roster, "A")).toHaveLength(2);
    expect(leaderOf(roster, "A")?.id).toBe("a0");
  });

  it("lets a returning player correct their name", () => {
    let roster = withTeams(1, 0);
    roster = join(roster, { id: "a0", name: "Shaun", team: "A" }, T0 + 500);
    expect(leaderOf(roster, "A")?.name).toBe("Shaun");
  });

  it("keeps a returning leader's readiness", () => {
    let roster = setReady(withTeams(1, 0), "a0", true);
    roster = join(roster, { id: "a0", name: "A0", team: "A" }, T0 + 500);
    expect(leaderOf(roster, "A")?.ready).toBe(true);
  });
});

describe("handing over the lead", () => {
  it("moves it to a teammate when the leader says so", () => {
    const roster = handOver(withTeams(3, 3), "a0", "a2");
    expect(leaderOf(roster!, "A")?.id).toBe("a2");
  });

  it("refuses anyone who is not leading", () => {
    expect(handOver(withTeams(3, 3), "a1", "a2")).toBeNull();
  });

  it("refuses handing the lead to the other side", () => {
    expect(handOver(withTeams(3, 3), "a0", "b1")).toBeNull();
  });

  it("refuses somebody who is not in the room", () => {
    expect(handOver(withTeams(3, 3), "a0", "nobody")).toBeNull();
  });
});

describe("taking over from an absent leader", () => {
  it("lets a teammate step in when the leader is gone", () => {
    const roster = claimLead(withTeams(3, 3), "a1", new Set(["a1", "a2"]));
    expect(leaderOf(roster!, "A")?.id).toBe("a1");
  });

  it("refuses while the leader is still connected", () => {
    expect(claimLead(withTeams(3, 3), "a1", new Set(["a0", "a1"]))).toBeNull();
  });

  it("is a no-op for somebody who already leads", () => {
    expect(claimLead(withTeams(3, 3), "a0", new Set())).toBeNull();
  });
});

describe("leaving for good", () => {
  it("passes the lead to the longest-serving teammate", () => {
    const roster = leave(withTeams(3, 3), "a0");
    expect(leaderOf(roster, "A")?.id).toBe("a1");
    expect(teamMembers(roster, "A")).toHaveLength(2);
  });

  it("leaves the side without a leader when the last of them goes", () => {
    let roster = withTeams(1, 1);
    roster = leave(roster, "a0");
    expect(roster.leaders.A).toBeNull();
  });

  it("does not disturb the lead when somebody else leaves", () => {
    const roster = leave(withTeams(3, 3), "a2");
    expect(leaderOf(roster, "A")?.id).toBe("a0");
  });
});

describe("the ready check", () => {
  it("waits until both sides are full", () => {
    expect(everyoneHere(withTeams(3, 2))).toBe(false);
    expect(everyoneHere(withTeams(3, 3))).toBe(true);
  });

  it("waits for every single person, not just the leaders", () => {
    let roster = withTeams(3, 3);
    for (const id of ["a0", "a1", "a2", "b0", "b1"]) roster = setReady(roster, id, true);
    expect(everyoneReady(roster)).toBe(false);
    roster = setReady(roster, "b2", true);
    expect(everyoneReady(roster)).toBe(true);
  });

  it("is not ready with a full side and an empty one", () => {
    let roster = withTeams(3, 0);
    for (const id of ["a0", "a1", "a2"]) roster = setReady(roster, id, true);
    expect(everyoneReady(roster)).toBe(false);
  });

  it("lets somebody take their readiness back", () => {
    let roster = withTeams(3, 3);
    for (const m of roster.members) roster = setReady(roster, m.id, true);
    expect(everyoneReady(roster)).toBe(true);
    expect(everyoneReady(setReady(roster, "b1", false))).toBe(false);
  });
});

describe("a lead nobody is holding", () => {
  const GRACE = 45_000;
  // withTeams seats a0..a2 and b0..b2, so a0 and b0 lead.
  const allConnected = new Set(["a0", "a1", "a2", "b0", "b1", "b2"]);
  const without = (...gone: string[]) => new Set([...allConnected].filter((id) => !gone.includes(id)));

  it("passes to the longest-serving connected teammate once the leader has been gone a while", () => {
    const passed = passOnAbandonedLead(withTeams(3, 3), without("a0"), T0 + GRACE + 1, GRACE);
    expect(passed!.leaders.A).toBe("a1");
    expect(passed!.leaders.B).toBe("b0");
  });

  it("waits out a blip rather than taking the job off somebody", () => {
    expect(passOnAbandonedLead(withTeams(3, 3), without("a0"), T0 + 5_000, GRACE)).toBeNull();
  });

  it("leaves it alone while the leader is connected", () => {
    expect(passOnAbandonedLead(withTeams(3, 3), allConnected, T0 + GRACE * 10, GRACE)).toBeNull();
  });

  it("keeps it where it is when the whole side has gone", () => {
    const passed = passOnAbandonedLead(withTeams(3, 3), without("a0", "a1", "a2"), T0 + GRACE * 10, GRACE);
    expect(passed?.leaders.A ?? "a0").toBe("a0");
  });

  it("counts from when they were last seen, not from when they joined", () => {
    const roster = touch(withTeams(3, 3), allConnected, T0 + 10 * 60_000);
    const seenAt = T0 + 10 * 60_000;
    expect(passOnAbandonedLead(roster, without("a0"), seenAt + 1_000, GRACE)).toBeNull();
    expect(passOnAbandonedLead(roster, without("a0"), seenAt + GRACE + 1, GRACE)?.leaders.A).toBe("a1");
  });
});
