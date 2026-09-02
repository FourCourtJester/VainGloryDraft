import { describe, expect, it } from "vitest";
import { clock, describeTurn, verbFor } from "../client/src/format.js";

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
