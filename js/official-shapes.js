// Official shape packs — curated, READ-ONLY prebuilt single shapes (backlog P2, 1.20.0), the
// single-shape sibling of official-templates.js. A pack is a set of verified sf.DataObject
// descriptors (the exact shape createElementFromComponent consumes) that renders as its own
// stencil section in the "{Type} Shapes" band, after the built-in categories (single-shape drops
// belong with the construction kit; the Templates band holds multi-shape starters).
//
// Storage model (same as official templates): the heavy field schemas live in same-origin
// `shapes/*.json` catalog files (CSP `connect-src 'self'` allows the fetch; SW-precached for
// offline, versioned cache name busts them on every bump — no `?v=` needed). This manifest keeps
// only id + label + per-item names, so the stencil can render searchable name tiles WITHOUT
// fetching a catalog; the fields fetch once, on the section's first reveal (or on a cold-start
// drop). Moving the MCE Data Views data here shrank components.js by ~40%. Keep `items` sorted
// alphabetically by label - the stencil renders them in manifest order.
//
// Adding a pack: drop `shapes/<slug>.json` ({ version, kind: 'diagramforce-shape-pack', id,
// label, components: [{ type: 'sf.DataObject', label, objectName, headerColor, fields }] }),
// add one manifest entry below (+ a sw.js precache line). `diagramTypes` lists every stencil the
// pack appears in; the FIRST entry is its home type (used for the Other Shapes cross-type run).

// ── Manifest (small; the field schemas are fetched lazily) ─────────────────
const OFFICIAL_SHAPE_PACKS = [
  {
    id: 'mce-data-views',
    label: 'MCE Data Views',
    diagramTypes: ['datamodel'],
    file: 'shapes/mce-data-views.json',
    items: [
      { objectName: '_AutomationActivityInstance', label: 'Automation Activity Instance' },
      { objectName: '_AutomationInstance', label: 'Automation Instance' },
      { objectName: '_Bounce', label: 'Bounce' },
      { objectName: '_BusinessUnitUnsubscribes', label: 'BU Unsubscribes' },
      { objectName: '_Click', label: 'Click' },
      { objectName: '_Complaint', label: 'Complaint' },
      { objectName: '_Job', label: 'Job' },
      { objectName: '_Journey', label: 'Journey' },
      { objectName: '_JourneyActivity', label: 'Journey Activity' },
      { objectName: '_ListSubscribers', label: 'List Subscribers' },
      { objectName: '_MobileAddress', label: 'Mobile Address' },
      { objectName: '_MobileSubscription', label: 'Mobile Subscription' },
      { objectName: '_Open', label: 'Open' },
      { objectName: '_PushAddress', label: 'Push Address' },
      { objectName: '_PushTag', label: 'Push Tag' },
      { objectName: '_Sent', label: 'Sent' },
      { objectName: '_SMSMessageTracking', label: 'SMS Message Tracking' },
      { objectName: '_SMSSubscriptionLog', label: 'SMS Subscription Log' },
      { objectName: '_SubscriberSMS', label: 'Subscriber SMS' },
      { objectName: '_Subscribers', label: 'Subscribers' },
      { objectName: '_UndeliverableSMS', label: 'Undeliverable SMS' },
      { objectName: '_Unsubscribe', label: 'Unsubscribe' },
    ],
  },
  {
    id: 'mcn-data-model-objects',
    label: 'MCN Data Model Objects',
    diagramTypes: ['datamodel', 'datamapping'],
    file: 'shapes/mcn-data-model-objects.json',
    items: [
      { objectName: 'Comm Subscription Channel Type', label: 'Comm Subscription Channel Type' },
      { objectName: 'Comm Subscription Consent', label: 'Comm Subscription Consent' },
      { objectName: 'Communication Subscription', label: 'Communication Subscription' },
      { objectName: 'Consent Status', label: 'Consent Status' },
      { objectName: 'Contact Point App', label: 'Contact Point App' },
      { objectName: 'Contact Point Consent', label: 'Contact Point Consent' },
      { objectName: 'Contact Point Email', label: 'Contact Point Email' },
      { objectName: 'Contact Point Phone', label: 'Contact Point Phone' },
      { objectName: 'Data Use Legal Basis', label: 'Data Use Legal Basis' },
      { objectName: 'Data Use Purpose', label: 'Data Use Purpose' },
      { objectName: 'Device', label: 'Device' },
      { objectName: 'Device Application Engagement', label: 'Device Application Engagement' },
      { objectName: 'Email Engagement', label: 'Email Engagement' },
      { objectName: 'Email Publication', label: 'Email Publication' },
      { objectName: 'Engagement Channel Type', label: 'Engagement Channel Type' },
      { objectName: 'Individual', label: 'Individual' },
      { objectName: 'Message Engagement', label: 'Message Engagement' },
      { objectName: 'Party Consent', label: 'Party Consent' },
      { objectName: 'Software Application', label: 'Software Application' },
      { objectName: 'Unified Individual', label: 'Unified Individual' },
      { objectName: 'Unified Link Individual', label: 'Unified Link Individual' },
    ],
  },
];

export function getOfficialShapePacks() {
  return OFFICIAL_SHAPE_PACKS;
}

// id → components[] once fetched (in-memory, per session — same pattern as official-templates).
const _cache = new Map();

/** Fetch (once, then cache) a pack's full component descriptors from its same-origin catalog.
 *  Every descriptor is forced to `type: 'sf.DataObject'` (a catalog can't smuggle other types);
 *  the graph-level sanitizer still covers the cells once they serialize into saves/shares.
 *  Returns the components array, or null (unknown id / fetch failure). */
export async function loadOfficialShapePack(id) {
  if (_cache.has(id)) return _cache.get(id);
  const meta = OFFICIAL_SHAPE_PACKS.find((p) => p.id === id);
  if (!meta) return null;
  let data;
  try {
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error(`${meta.file} → HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.warn('Diagramforce: official shape pack failed to load', id, err);
    return null;
  }
  const components = (Array.isArray(data?.components) ? data.components : [])
    .filter((c) => c && typeof c === 'object' && Array.isArray(c.fields))
    .map((c) => ({ ...c, type: 'sf.DataObject' }));
  if (!components.length) return null;
  _cache.set(id, components);
  return components;
}
