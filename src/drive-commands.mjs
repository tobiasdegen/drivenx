/**
 * Drive-specific, asynchronous UI commands. The renderer owns notifications;
 * the bridge owns all privileged operations. Both commands retain a selection
 * ticket so a late result cannot be shown on a different drive.
 */
export async function exportSelectedReport({
  device,
  format,
  locale,
  reportId,
  selectedKey,
  tracker,
  exportReport,
  onNotice,
  onError,
}) {
  const ticket = tracker.snapshotTicket(selectedKey);
  try {
    const result = await exportReport(device, format, locale, reportId);
    if (!result.canceled && tracker.isSnapshotCurrent(ticket)) onNotice(result.path || '');
  } catch (error) {
    if (tracker.isSnapshotCurrent(ticket)) onError(String(error));
  }
}

/**
 * The confirmation dialog may synchronously yield control to the native UI.
 * Verify the selection again before starting any device operation. The lock
 * stays held until the device command AND its optional refresh have finished.
 */
export async function runSelectedSelfTest({
  device,
  kind,
  reportId,
  selectedKey,
  tracker,
  pendingTests,
  scanRunning,
  confirm,
  execute,
  invalidate,
  reload,
  onRunning,
  onNotice,
  onError,
  onShowTests,
}) {
  if (pendingTests.has(selectedKey)) return;
  const ticket = tracker.snapshotTicket(selectedKey);
  if (!confirm()) return;
  // A refresh of the same drive can replace the report while the native
  // confirmation is open. That old report must not authorize a new self-test.
  if (!tracker.isSnapshotCurrent(ticket) || scanRunning()) return;
  pendingTests.add(selectedKey);
  onRunning(true);
  // A self-test may modify SMART state even when the command times out or
  // fails. Revoke the old renderer snapshot *before* calling the backend,
  // so concurrent foreground/sidebar reads cannot restore its old state.
  invalidate(selectedKey, ticket.scanGeneration);
  try {
    await execute(device, kind, reportId);
    if (tracker.isSelected(ticket)) {
      onNotice();
      await reload(device);
      if (tracker.isSelected(ticket)) onShowTests();
    }
  } catch (error) {
    if (tracker.isSelected(ticket)) onError(String(error));
  } finally {
    pendingTests.delete(selectedKey);
    onRunning(false);
  }
}
