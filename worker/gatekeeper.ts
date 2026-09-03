/**
 * Keeps any one person from making rooms faster than a person plausibly would.
 *
 * Anybody can start a draft here, which is the whole point of the thing — but
 * "anybody" includes somebody running a script, and a room is not free: it is
 * storage that sticks around, and a day only has so many requests in it on the
 * free plan. So each address gets a small allowance that refills as time
 * passes, plus a ceiling on how many rooms it can make in a day.
 *
 * There is one of these per address, which is what makes it simple: the object
 * *is* the address, so there is no table of addresses to keep. The count is
 * written down rather than merely remembered, because an object that has gone
 * quiet gets put away, and a script that paces itself must not be handed a
 * fresh allowance every time that happens. What is written down clears itself
 * out a day later, so the addresses that pass through leave nothing behind.
 */

/** Rooms an address may make in one go, before it has to wait for the drip. */
const BURST = 5;

/** How often a spent allowance comes back. Three rooms a minute, sustained. */
const REFILL_EVERY_MS = 20_000;

/** The most rooms one address may make in a day, however patiently. */
const DAILY = 100;

const DAY_MS = 24 * 60 * 60_000;

const TALLY_KEY = "tally";

export interface RateVerdict {
  readonly allowed: boolean;
  /** Seconds to wait before trying again. Only meaningful when refused. */
  readonly retryAfter: number;
}

/** What one address has spent, and when its allowance was last topped up. */
interface Tally {
  allowance: number;
  toppedUpAt: number;
  today: number;
  dayBeganAt: number;
}

export class Gatekeeper implements DurableObject {
  readonly #ctx: DurableObjectState;
  #tally: Tally | null = null;

  constructor(ctx: DurableObjectState) {
    this.#ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      this.#tally = (await ctx.storage.get<Tally>(TALLY_KEY)) ?? null;
    });
  }

  async fetch(): Promise<Response> {
    const now = Date.now();
    let tally = this.#tally ?? { allowance: BURST, toppedUpAt: now, today: 0, dayBeganAt: now };

    // A fresh day wipes the slate.
    if (now - tally.dayBeganAt >= DAY_MS) {
      tally = { allowance: BURST, toppedUpAt: now, today: 0, dayBeganAt: now };
    }

    // Top the allowance back up for however long has passed since it was last
    // touched, never beyond the burst it started with.
    const earned = Math.floor((now - tally.toppedUpAt) / REFILL_EVERY_MS);
    if (earned > 0) {
      tally.allowance = Math.min(BURST, tally.allowance + earned);
      tally.toppedUpAt = Math.min(now, tally.toppedUpAt + earned * REFILL_EVERY_MS);
    }

    if (tally.today >= DAILY) {
      await this.#remember(tally);
      return verdict(false, Math.ceil((tally.dayBeganAt + DAY_MS - now) / 1000));
    }

    if (tally.allowance < 1) {
      await this.#remember(tally);
      return verdict(false, Math.ceil((tally.toppedUpAt + REFILL_EVERY_MS - now) / 1000));
    }

    tally.allowance -= 1;
    tally.today += 1;
    await this.#remember(tally);
    return verdict(true, 0);
  }

  /**
   * Forgets an address entirely once its day is up.
   *
   * A count that has run its course is not worth keeping, and an address that
   * made one room last week should cost nothing to have around.
   */
  async alarm(): Promise<void> {
    this.#tally = null;
    await this.#ctx.storage.deleteAll();
  }

  async #remember(tally: Tally): Promise<void> {
    this.#tally = tally;
    await this.#ctx.storage.put(TALLY_KEY, tally);
    // One alarm, set for the end of this address's day, to sweep the count away.
    if ((await this.#ctx.storage.getAlarm()) === null) {
      await this.#ctx.storage.setAlarm(tally.dayBeganAt + DAY_MS);
    }
  }
}

function verdict(allowed: boolean, retryAfter: number): Response {
  return new Response(JSON.stringify({ allowed, retryAfter } satisfies RateVerdict), {
    headers: { "content-type": "application/json" },
  });
}
