/**
 * Tracks asynchronous results for a mounted, report-bound view. Different
 * lanes may run independently; an exclusive action (history import/export/save)
 * cannot overlap another request. Invalidation makes every old completion a
 * no-op, including a completion from a previous device with the same path.
 *
 * This is UI-only coordination: backend snapshot checks still authorize every
 * privileged operation and every persistent write.
 */
/** @typedef {Readonly<{lane: string, epoch: number, serial: number}>} AsyncViewTicket */
/** @typedef {{
 * begin(lane: string, options?: {exclusive?: boolean}): AsyncViewTicket | null,
 * isCurrent(ticket: AsyncViewTicket | null): boolean,
 * finish(ticket: AsyncViewTicket | null): boolean,
 * invalidate(): void,
 * isBusy(): boolean
 * }} AsyncViewGuard
 */
/** @returns {AsyncViewGuard} */
export function createAsyncViewGuard() {
  let epoch = 0;
  let serial = 0;
  const pending = new Map();

  function begin(lane, { exclusive = false } = {}) {
    if (pending.has(lane) || (exclusive && pending.size > 0)) return null;
    const ticket = { lane, epoch, serial: ++serial };
    pending.set(lane, ticket);
    return ticket;
  }

  function isCurrent(ticket) {
    return !!ticket && ticket.epoch === epoch && pending.get(ticket.lane) === ticket;
  }

  function finish(ticket) {
    if (!isCurrent(ticket)) return false;
    pending.delete(ticket.lane);
    return true;
  }

  function invalidate() {
    epoch++;
    pending.clear();
  }

  return { begin, isCurrent, finish, invalidate, isBusy: () => pending.size > 0 };
}
