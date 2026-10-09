/** Gemini free-tier quotas reset at midnight Pacific time. */
export const pacificDay = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);

/** Sliding-window request limiter per key (visitor IP). In-memory: one Render instance. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a request; returns false when the key is over its limit. */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

type Usage = { day: string; count: number; blockedUntil: number };

/**
 * Routes copilot requests across models by remaining free-tier quota. Each model gets a
 * daily cap below Google's limit so the plan architect and invoice notes keep headroom.
 * Conversations are pinned to one model: Gemini thought signatures are model-specific.
 */
export class QuotaRouter {
  private usage = new Map<string, Usage>();
  private pins = new Map<string, { model: string; at: number }>();

  constructor(
    private readonly models: string[],
    private readonly dailyCap: number,
    private readonly pinTtlMs = 30 * 60_000,
  ) {}

  private entry(model: string, now: Date): Usage {
    const day = pacificDay(now);
    let usage = this.usage.get(model);
    if (!usage || usage.day !== day) {
      usage = { day, count: 0, blockedUntil: 0 };
      this.usage.set(model, usage);
    }
    return usage;
  }

  available(model: string, now: Date) {
    const usage = this.entry(model, now);
    return usage.blockedUntil <= now.getTime() && usage.count < this.dailyCap;
  }

  /** First model with quota left, optionally skipping some. */
  pick(now: Date, skip: string[] = []) {
    return this.models.find((m) => !skip.includes(m) && this.available(m, now)) ?? null;
  }

  recordSuccess(model: string, now: Date) {
    this.entry(model, now).count += 1;
  }

  /** Blocks a model for `forMs` (per-minute limit) or, by default, until the quota resets. */
  markExhausted(model: string, now: Date, forMs?: number) {
    this.entry(model, now).blockedUntil = forMs === undefined ? Number.POSITIVE_INFINITY : now.getTime() + forMs;
  }

  pin(key: string, model: string, now: Date) {
    this.pins.set(key, { model, at: now.getTime() });
  }

  pinned(key: string, now: Date) {
    const pin = this.pins.get(key);
    if (!pin || now.getTime() - pin.at > this.pinTtlMs) return null;
    pin.at = now.getTime();
    return pin.model;
  }

  snapshot(now: Date) {
    return this.models.map((model) => ({ model, ...this.entry(model, now), cap: this.dailyCap }));
  }
}
