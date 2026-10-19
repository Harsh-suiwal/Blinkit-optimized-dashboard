// Admin-taught aliases are stored in kv key "brandAliases"; the known defaults live here
// and admin additions win over them. kv is required lazily so the pure resolve
// functions stay usable without Supabase when an aliases map is passed in.
const ALIASES_KEY = 'brandAliases';
const DEFAULT_ALIASES = {
  oicia: 'Oicia',
  smarteez: 'Smarteez',
};

/**
 * Loads the alias map: lowercase raw string -> canonical brand name.
 * Pass the result into resolveBrand/normalizeBrand when resolving many rows
 * so the file is read once per parse, not once per row.
 */
function loadAliases() {
  const stored = require('../store/kv').peek(ALIASES_KEY, {});
  return { ...DEFAULT_ALIASES, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** Persists one admin-taught alias (raw string -> canonical brand). */
async function saveAlias(raw, canonical) {
  const kv = require('../store/kv');
  const stored = kv.get(ALIASES_KEY, {}) || {};
  stored[String(raw).toLowerCase().trim()] = String(canonical).trim();
  await kv.set(ALIASES_KEY, stored);
}

function titleCaseWords(str) {
  return str.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Canonical form for a brand name that came from a real column.
 * Alias match wins; otherwise the text is kept as the source wrote it, and
 * only re-cased when it is entirely lower/upper case ("OICIA" -> "Oicia").
 */
function normalizeBrand(rawBrand, aliases = loadAliases()) {
  if (!rawBrand || typeof rawBrand !== 'string') return '';
  const trimmed = rawBrand.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const aliasMatch = aliases[trimmed.toLowerCase()];
  if (aliasMatch) return aliasMatch;

  const isUniformCase = trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase();
  return isUniformCase ? titleCaseWords(trimmed) : trimmed;
}

/**
 * Resolves a brand from an explicit brand field or a free-text name
 * (campaign name, file name, ...).
 *
 * Order: explicit field -> whole-name alias -> alias key found inside the
 * name -> first segment (before _ or |) as an alias -> 'Unknown'.
 * There is deliberately no "first word" guess: it would invent brands such as
 * "Recommendation" from "Recommendation_Knife_02_July".
 *
 * @returns {{ brand: string, confidence: 'explicit'|'alias'|'parsed'|'guessed' }}
 */
function resolveBrand(name, explicitBrand, aliases = loadAliases()) {
  if (explicitBrand && typeof explicitBrand === 'string' && explicitBrand.trim()) {
    return { brand: normalizeBrand(explicitBrand, aliases), confidence: 'explicit' };
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return { brand: 'Unknown', confidence: 'guessed' };
  }

  const lower = name.trim().toLowerCase();

  if (aliases[lower]) return { brand: aliases[lower], confidence: 'alias' };

  for (const [key, canonical] of Object.entries(aliases)) {
    if (key.length >= 3 && lower.includes(key)) {
      return { brand: canonical, confidence: 'parsed' };
    }
  }

  const segment = lower.split(/[_|]/)[0].trim();
  if (segment && aliases[segment]) return { brand: aliases[segment], confidence: 'parsed' };

  return { brand: 'Unknown', confidence: 'guessed' };
}

module.exports = { resolveBrand, normalizeBrand, loadAliases, saveAlias };
