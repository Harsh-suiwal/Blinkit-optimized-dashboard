// "Undo the last upload" for the admin Uploads panel. Before an upload changes anything, the previous
// value of every kv key it can touch is saved (one slot per report type, `uploadUndo:<kind>`). Undo puts
// those values back. Only the latest upload of each report type can be undone, and a newer upload of a
// report type that shares data (Sales and Monthly sales both write `salesMonthly`) drops the other's undo,
// because its saved copy is no longer a clean "before".
const kv = require('./kv');

const KINDS = {
  inventory: { label: 'Stock report', keys: ['history', 'latest'] },
  sales: { label: 'Sales report', keys: ['salesHistory', 'salesLatest', 'salesByProduct', 'salesMonthly'] },
  salesMonthly: { label: 'Monthly sales report', keys: ['salesMonthly'] },
  campaign: { label: 'Advertising report', keys: ['campaignData'] },
  costs: { label: 'Cost sheet', keys: ['brandCosts'] },
};
const UNDO_KINDS = Object.keys(KINDS);
const slotKey = (kind) => `uploadUndo:${kind}`;

/** Call inside a mutating route, after the upload has been checked and BEFORE its first write. */
async function captureUndo(kind, { fileName, brands }) {
  const def = KINDS[kind];
  if (!def) throw new Error(`Unknown upload kind: ${kind}`);
  const keys = {};
  for (const key of def.keys) keys[key] = kv.peek(key, null); // null = the key did not exist
  await kv.set(slotKey(kind), {
    kind,
    label: def.label,
    fileName: fileName || '',
    at: new Date().toISOString(),
    brands: Array.from(new Set(brands || [])),
    keys,
  });
  for (const [other, otherDef] of Object.entries(KINDS)) {
    const shares = otherDef.keys.some((key) => def.keys.includes(key));
    if (other !== kind && shares && kv.peek(slotKey(other), null)) await kv.delete(slotKey(other));
  }
}

/** The uploads that can be undone, newest first (without the saved data). */
function listUndo() {
  return UNDO_KINDS
    .map((kind) => kv.peek(slotKey(kind), null))
    .filter(Boolean)
    .map(({ kind, label, fileName, at, brands }) => ({ kind, label, fileName, at, brands }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Restores the saved values and forgets them. Returns what was undone, or null when there is nothing to undo. */
async function undoUpload(kind) {
  const saved = kv.peek(slotKey(kind), null);
  if (!saved) return null;
  for (const [key, value] of Object.entries(saved.keys)) {
    if (value === null) {
      if (kv.peek(key, null) !== null) await kv.delete(key);
    } else {
      await kv.set(key, value);
    }
  }
  await kv.delete(slotKey(kind)); // last, so a failed restore can be retried
  return { kind: saved.kind, label: saved.label, fileName: saved.fileName, brands: saved.brands };
}

module.exports = { captureUndo, listUndo, undoUpload, UNDO_KINDS };
