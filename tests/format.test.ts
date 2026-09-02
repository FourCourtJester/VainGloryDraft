import { describe, expect, it } from "vitest";
import { clock, describeTurn, duration, verbFor } from "../client/src/format.js";

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
    expect(describeTurn({ team: "A", action: "ban", count: 1 })).toBe("Team A bans");
    expect(describeTurn({ team: "B", action: "pick", count: 1 })).toBe("Team B picks");
  });

  it("says how many when a turn takes more than one", () => {
    expect(describeTurn({ team: "B", action: "pick", count: 2 })).toBe("Team B picks 2");
  });

  it("gives the button its verb", () => {
    expect(verbFor({ team: "A", action: "ban", count: 1 })).toBe("Ban");
    expect(verbFor({ team: "A", action: "pick", count: 2 })).toBe("Pick");
  });
});
