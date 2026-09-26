// Typed errors. `code` maps 1:1 to an HTTP status so a server can pass them straight through.
export const STATUS = { BAD_INPUT: 400, NOT_FOUND: 404, NO_REPO: 422, RATE_LIMITED: 429, UPSTREAM: 502 };

export class StarcropError extends Error {
  /**
   * @param {'BAD_INPUT'|'NOT_FOUND'|'NO_REPO'|'RATE_LIMITED'|'UPSTREAM'} code
   * @param {string} message human-readable, safe to show
   * @param {{ retryAfter?: number, token?: { mint: string, name: string, symbol: string } }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'StarcropError';
    this.code = code;
    this.status = STATUS[code] || 500;
    if (extra.retryAfter != null) this.retryAfter = extra.retryAfter;
    if (extra.token) this.token = extra.token;
  }
  toJSON() {
    const o = { error: this.message, code: this.code };
    if (this.retryAfter != null) o.retryAfter = this.retryAfter;
    if (this.token) o.token = this.token;
    return o;
  }
}

/** Thrown internally when the time budget ran out; the survey turns it into `partial: true`. */
export class BudgetError extends Error {
  constructor(msg = 'time budget exhausted') { super(msg); this.name = 'BudgetError'; }
}
