import { describe, expect, it } from "vitest";
import { clock, describeTurn, duration, slotOf, tally, verbFor } from "../client/src/format.js";
import { ACTIONS, TEAMS } from "./helpers.js";

describe("clock", () => {
  it("counts tenths under ten seconds", () => {
    expect(clock(9_400)).toBe("9.4");
    expect(clock(1_000)).toBe("1.0");
    expect(clock(0)).toBe("0.0");
  });

  it("never rounds its way into a wrong format", () => {
    // A countdown has to fall through ten seconds cleanly. Reading "0:10" and
    // then "10.0" a moment later would look broken to a captain under pressure.
    expect(clock(9_999)).toBe("9.9");
    expect(clock(10_000)).toBe("0:10");
    expect(clock(59_999)).toBe("0:59");
    expect(clock(60_000)).toBe("1:00");
  });

  it("treats a passed deadline as zero rather than counting backwards", () => {
    expect(clock(-5_000)).toBe("0.0");
  });

  it("pads seconds", () => {
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_600_000)).toBe("60:00");
  });
});

describe("duration", () => {
  it("reads in seconds while that is still legible", () => {
    expect(duration(0)).toBe("0.0s");
    expect(duration(1_050)).toBe("1.1s");
    expect(duration(59_940)).toBe("59.9s");
  });

  it("switches to minutes once seconds stop being useful", () => {
    expect(duration(60_000)).toBe("1m 00s");
    expect(duration(95_000)).toBe("1m 35s");
    expect(duration(3_600_000)).toBe("60m 00s");
  });

  it("never reads as a negative length of time", () => {
    expect(duration(-1)).toBe("0.0s");
  });
});

describe("describeTurn", () => {
  it("names the team and the action", () => {
    expect(describeTurn({ teams: ["A"], action: "ban", count: 1 }, TEAMS, ACTIONS)).toBe("Team A · Ban");
    expect(describeTurn({ teams: ["B"], action: "pick", count: 1 }, TEAMS, ACTIONS)).toBe("Team B · Pick");
  });

  it("says how many when a turn takes more than one", () => {
    expect(describeTurn({ teams: ["B"], action: "pick", count: 2 }, TEAMS, ACTIONS)).toBe("Team B · Pick 2");
  });

  it("names every team on a blind turn, and nobody on a turn the draft plays", () => {
    expect(describeTurn({ teams: ["A", "B"], action: "ban", count: 1 }, TEAMS, ACTIONS)).toBe("Team A + Team B · Ban");
    expect(describeTurn({ teams: [], action: "pick", count: 1 }, TEAMS, ACTIONS)).toBe("Remaining · Pick");
  });

  it("gives the button its verb", () => {
    expect(verbFor({ teams: ["A"], action: "ban", count: 1 }, ACTIONS)).toBe("Ban");
    expect(verbFor({ teams: ["A"], action: "pick", count: 2 }, ACTIONS)).toBe("Pick");
  });
});

describe("colours and counts", () => {
  it("colours a team by its place, not its name", () => {
    expect(slotOf(TEAMS, "A")).toBe("t0");
    expect(slotOf(TEAMS, "B")).toBe("t1");
    expect(slotOf([...TEAMS, { id: "C", name: "C" }, { id: "D", name: "D" }, { id: "E", name: "E" }], "E")).toBe("t0");
  });

  it("counts an action in words", () => {
    expect(tally(4, ACTIONS[0]!)).toBe("4 bans");
    expect(tally(1, ACTIONS[1]!)).toBe("1 pick");
  });
});
