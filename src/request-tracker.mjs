// Pure request lifecycle tracking for React. No timers or Electron dependencies.
// A new scan invalidates every earlier request. A selection change invalidates
// foreground work without preventing valid sidebar reads for other devices.
/** @typedef {{ key: string, scanGeneration: number, selectionGeneration: number }} SelectionTicket */
/** @typedef {SelectionTicket & {detailVersion: number}} SnapshotTicket */
/** @typedef {SelectionTicket & {foreground: boolean, serial: number}} DetailTicket */
/** @typedef {{
 * beginScan(): number,
 * isScanCurrent(generation: number): boolean,
 * select(key: string): void,
 * isCurrentSelection(key: string): boolean,
 * selectedTicket(key: string): SelectionTicket,
 * isSelected(ticket: SelectionTicket): boolean,
 * snapshotTicket(key: string): SnapshotTicket,
 * isSnapshotCurrent(ticket: SnapshotTicket): boolean,
 * invalidateDetail(key: string): number,
 * beginDetail(key: string, foreground?: boolean): DetailTicket,
 * isDetailCurrent(ticket: DetailTicket): boolean
 * }} RequestTracker
 */
/** @returns {RequestTracker} */
export function createRequestTracker() {
  let scanGeneration = 0;
  let selectionGeneration = 0;
  let selectedKey = '';
  let serial = 0;
  const latestDetails = new Map();

  function beginScan() {
    scanGeneration++;
    selectionGeneration++;
    latestDetails.clear();
    return scanGeneration;
  }

  function isScanCurrent(generation) {
    return generation === scanGeneration;
  }

  function select(key) {
    if (selectedKey !== key) {
      selectedKey = key;
      selectionGeneration++;
    }
  }

  function isCurrentSelection(key) {
    return selectedKey === key;
  }

  function selectedTicket(key) {
    return { key, scanGeneration, selectionGeneration };
  }

  function isSelected(ticket) {
    return (
      ticket.key === selectedKey &&
      ticket.scanGeneration === scanGeneration &&
      ticket.selectionGeneration === selectionGeneration
    );
  }

  // A new reading (or a self-test) revokes every older reading for this
  // access path, including optional sidebar reads which are still pending.
  function invalidateDetail(key) {
    const version = ++serial;
    latestDetails.set(key, version);
    return version;
  }

  function snapshotTicket(key) {
    return { ...selectedTicket(key), detailVersion: latestDetails.get(key) ?? 0 };
  }

  function isSnapshotCurrent(ticket) {
    return isSelected(ticket) && (latestDetails.get(ticket.key) ?? 0) === ticket.detailVersion;
  }

  function beginDetail(key, foreground = true) {
    const ticket = { ...selectedTicket(key), foreground, serial: invalidateDetail(key) };
    return ticket;
  }

  function isDetailCurrent(ticket) {
    return (
      ticket.scanGeneration === scanGeneration &&
      latestDetails.get(ticket.key) === ticket.serial &&
      (!ticket.foreground || isSelected(ticket))
    );
  }

  return {
    beginScan,
    isScanCurrent,
    select,
    isCurrentSelection,
    selectedTicket,
    isSelected,
    snapshotTicket,
    isSnapshotCurrent,
    invalidateDetail,
    beginDetail,
    isDetailCurrent,
  };
}
