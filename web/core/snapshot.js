/**
 * A frozen copy of the current workflow.
 *
 * "Frozen" means a deep copy that shares nothing with the live canvas: what
 * the queue stores is what the task will run with, no matter what the user
 * edits afterwards. The canvas keeps changing, the snapshot does not.
 */

export function freezeSnapshot(value) {
  if (value === null || value === undefined) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (err) {
    /* fall through to the JSON copy */
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
}
