/*
 * Ready-made regex templates for custom extraction rules (admin panel).
 *
 * Each template:
 *   id, category, name, column (default column name), description,
 *   pattern, flags, group        – the regex (group: capture group to keep, 0 = whole match)
 *   example, expect              – sample text and the values the template extracts from it
 *   params (optional)            – [{ key, label, default }] fill-in values; `build(values)`
 *                                  returns { pattern, column } for them
 */

const esc = (s: string): string => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Allow flexible spaces inside a typed label ("Order  ID" matches "Order ID").
const label = (s: string): string => esc(String(s).trim()).replace(/\s+/g, '\\s+');

/** A fill-in value of a template (e.g. the label to look for). */
export interface TemplateParam {
  key: string;
  label: string;
  default: string;
}

export type TemplateValues = Record<string, string>;

/** A ready-made regex for a custom rule. */
export interface Template {
  id: string;
  category: string;
  name: string;
  /** Default column name. */
  column?: string;
  description: string;
  pattern?: string;
  flags: string;
  /** Capture group to keep (0 = whole match). */
  group: number;
  example: string;
  /** Values the template extracts from `example`. */
  expect: string[];
  params?: TemplateParam[];
  /** Pattern and column for fill-in values. */
  build?: (values: TemplateValues) => { pattern: string; column: string };
  /** Example text for fill-in values. */
  exampleFor?: (values: TemplateValues) => string;
}

/** The custom rule a template produces. */
export interface ResolvedRule {
  name: string;
  pattern: string;
  flags: string;
  group: number;
}

const TEMPLATES: Template[] = [
  // ----- Fill in your own label -----
  {
    id: 'after-label',
    category: 'Fill-in',
    name: 'Text after a label',
    description: 'Everything after "Label:" up to the end of the line. Works with ":", "-", "#" or "=" after the label.',
    params: [{ key: 'label', label: 'Label', default: 'Customer' }],
    build: (p: TemplateValues) => ({ pattern: `${label(p.label)}\\s*[:#=-]?\\s*([^\\n]+)`, column: p.label.trim() }),
    flags: 'i',
    group: 1,
    exampleFor: (p: TemplateValues) => `${p.label}: Acme Corp\nCity: Rome`,
    example: 'Customer: Acme Corp\nCity: Rome',
    expect: ['Acme Corp'],
  },
  {
    id: 'word-after-label',
    category: 'Fill-in',
    name: 'Code or word after a label',
    description: 'The single word or code right after a label, e.g. an ID: letters, digits, "-", "_" and "/".',
    params: [{ key: 'label', label: 'Label', default: 'Ref' }],
    build: (p: TemplateValues) => ({ pattern: `${label(p.label)}\\s*[:#=-]?\\s*([A-Za-z0-9][A-Za-z0-9_/-]*)`, column: p.label.trim() }),
    flags: 'i',
    group: 1,
    exampleFor: (p: TemplateValues) => `Payment received, ${p.label}: TX-88213 on Monday`,
    example: 'Payment received, Ref: TX-88213 on Monday',
    expect: ['TX-88213'],
  },
  {
    id: 'number-after-label',
    category: 'Fill-in',
    name: 'Number after a label',
    description: 'A number (with optional sign, thousands commas and decimals) right after a label.',
    params: [{ key: 'label', label: 'Label', default: 'Qty' }],
    build: (p: TemplateValues) => ({ pattern: `${label(p.label)}\\s*[:#=-]?\\s*([-+]?\\d[\\d,]*(?:\\.\\d+)?)`, column: p.label.trim() }),
    flags: 'i',
    group: 1,
    exampleFor: (p: TemplateValues) => `Item: Desk lamp  ${p.label}: 1,200  Note: fragile`,
    example: 'Item: Desk lamp  Qty: 1,200  Note: fragile',
    expect: ['1,200'],
  },
  {
    id: 'between',
    category: 'Fill-in',
    name: 'Text between two markers',
    description: 'Whatever is between a start and an end marker (can span lines).',
    params: [
      { key: 'start', label: 'Starts after', default: '[' },
      { key: 'end', label: 'Ends before', default: ']' },
    ],
    build: (p: TemplateValues) => ({ pattern: `${esc(p.start)}([\\s\\S]*?)${esc(p.end)}`, column: 'Between' }),
    flags: '',
    group: 1,
    exampleFor: (p: TemplateValues) => `Status ${p.start}Approved${p.end} by ${p.start}Finance team${p.end}`,
    example: 'Status [Approved] by [Finance team]',
    expect: ['Approved', 'Finance team'],
  },
  {
    id: 'line-starting',
    category: 'Fill-in',
    name: 'Whole line starting with…',
    description: 'Every line that begins with the given text.',
    params: [{ key: 'start', label: 'Line starts with', default: 'Note' }],
    build: (p: TemplateValues) => ({ pattern: `^[ \\t]*${label(p.start)}.*$`, column: p.start.trim() }),
    flags: 'im',
    group: 0,
    exampleFor: (p: TemplateValues) => `Order shipped\n${p.start}: leave at reception\nThanks`,
    example: 'Order shipped\nNote: leave at reception\nThanks',
    expect: ['Note: leave at reception'],
  },

  // ----- IDs & codes -----
  {
    id: 'invoice',
    category: 'IDs & codes',
    name: 'Invoice number',
    column: 'Invoice No',
    description: 'Invoice numbers like INV-2041, INV2041 or INV#2041.',
    pattern: '\\bINV[-#]?\\s?\\d{3,}\\b',
    flags: 'i',
    group: 0,
    example: 'Please pay Invoice INV-2041 and INV#2042 by Friday',
    expect: ['INV-2041', 'INV#2042'],
  },
  {
    id: 'order',
    category: 'IDs & codes',
    name: 'Order number',
    column: 'Order',
    description: 'The code after "Order", "Order #", "Order no." or "Order ID".',
    pattern: '\\border\\s*(?:no\\.?|number|id)?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9-]{3,})',
    flags: 'i',
    group: 1,
    example: 'Your Order #A12345 has shipped. Order ID: 778-1201',
    expect: ['A12345', '778-1201'],
  },
  {
    id: 'sku',
    category: 'IDs & codes',
    name: 'SKU / product code',
    column: 'SKU',
    description: '2–4 capital letters, a dash, then 3–6 digits (e.g. AB-1234).',
    pattern: '\\b[A-Z]{2,4}-\\d{3,6}\\b',
    flags: '',
    group: 0,
    example: 'Restock items AB-1234 and XYZ-90210',
    expect: ['AB-1234', 'XYZ-90210'],
  },
  {
    id: 'ups',
    category: 'IDs & codes',
    name: 'UPS tracking number',
    column: 'Tracking',
    description: '"1Z" followed by 16 letters or digits.',
    pattern: '\\b1Z[0-9A-Z]{16}\\b',
    flags: 'i',
    group: 0,
    example: 'Tracking: 1Z999AA10123456784',
    expect: ['1Z999AA10123456784'],
  },
  {
    id: 'uuid',
    category: 'IDs & codes',
    name: 'UUID',
    column: 'UUID',
    description: 'Standard UUIDs such as 123e4567-e89b-12d3-a456-426614174000.',
    pattern: '\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b',
    flags: 'i',
    group: 0,
    example: 'request id 123e4567-e89b-12d3-a456-426614174000 failed',
    expect: ['123e4567-e89b-12d3-a456-426614174000'],
  },

  // ----- Numbers & money -----
  {
    id: 'percent',
    category: 'Numbers & money',
    name: 'Percentage',
    column: 'Percent',
    description: 'Numbers followed by %, e.g. 12.5%.',
    pattern: '[-+]?\\d+(?:\\.\\d+)?\\s?%',
    flags: '',
    group: 0,
    example: 'Sales up 12.5% and costs -3 %',
    expect: ['12.5%', '-3 %'],
  },
  {
    id: 'quantity',
    category: 'Numbers & money',
    name: 'Quantity with unit',
    column: 'Quantity',
    description: 'A number with a unit: kg, g, lb, km, m, cm, L, ml, pcs, units…',
    pattern: '\\b\\d+(?:[.,]\\d+)?\\s?(?:kg|g|lbs?|oz|km|m|cm|mm|mi|l|ml|pcs|units?)\\b',
    flags: 'i',
    group: 0,
    example: 'Ship 2.5 kg of rice and 12 pcs of soap',
    expect: ['2.5 kg', '12 pcs'],
  },
  {
    id: 'number',
    category: 'Numbers & money',
    name: 'Any number',
    column: 'Number',
    description: 'Any whole or decimal number, with optional thousands commas.',
    pattern: '[-+]?\\b\\d[\\d,]*(?:\\.\\d+)?\\b',
    flags: '',
    group: 0,
    example: 'Rooms 12 and 1,250.75 total',
    expect: ['12', '1,250.75'],
  },
  {
    id: 'iban',
    category: 'Numbers & money',
    name: 'IBAN (bank account)',
    column: 'IBAN',
    description: 'International bank account numbers, with or without spaces.',
    pattern: '\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\\b',
    flags: '',
    group: 0,
    example: 'Pay to GB82 WEST 1234 5698 7654 32 by Friday',
    expect: ['GB82 WEST 1234 5698 7654 32'],
  },

  // ----- Date & time -----
  {
    id: 'time',
    category: 'Date & time',
    name: 'Time',
    column: 'Time',
    description: '24-hour or 12-hour times: 09:30, 9:30 AM, 18:45:10.',
    pattern: '\\b(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?:\\s?[AaPp]\\.?[Mm]\\.?)?',
    flags: '',
    group: 0,
    example: 'Meeting at 9:30 AM, ends 18:45',
    expect: ['9:30 AM', '18:45'],
  },
  {
    id: 'datetime',
    category: 'Date & time',
    name: 'ISO date and time',
    column: 'Timestamp',
    description: 'Timestamps like 2026-11-02T14:30:00Z or 2026-11-02 14:30.',
    pattern: '\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?',
    flags: '',
    group: 0,
    example: 'Created 2026-11-02T14:30:00Z, updated 2026-11-03 09:15',
    expect: ['2026-11-02T14:30:00Z', '2026-11-03 09:15'],
  },

  // ----- Web & social -----
  {
    id: 'mention',
    category: 'Web & social',
    name: '@mention / handle',
    column: 'Handle',
    description: '@username handles (not email addresses).',
    pattern: '(?<![\\w@.])@[A-Za-z0-9_]{2,30}\\b',
    flags: '',
    group: 0,
    example: 'Thanks @jane_doe and @acme! Mail me at bob@example.com',
    expect: ['@jane_doe', '@acme'],
  },
  {
    id: 'domain',
    category: 'Web & social',
    name: 'Domain name',
    column: 'Domain',
    description: 'Website domains such as example.com or shop.example.co.uk.',
    pattern: '\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}\\b',
    flags: 'i',
    group: 0,
    example: 'Moved from oldsite.org to shop.example.co.uk',
    expect: ['oldsite.org', 'shop.example.co.uk'],
  },
  {
    id: 'hex-color',
    category: 'Web & social',
    name: 'Hex color',
    column: 'Color',
    description: 'CSS colours like #2563eb or #fff.',
    pattern: '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b',
    flags: '',
    group: 0,
    example: 'Primary #2563eb, text #fff',
    expect: ['#2563eb', '#fff'],
  },

  // ----- Addresses -----
  {
    id: 'us-zip',
    category: 'Addresses',
    name: 'US ZIP code',
    column: 'ZIP',
    description: '5-digit ZIP codes, optionally with +4.',
    pattern: '\\b\\d{5}(?:-\\d{4})?\\b',
    flags: '',
    group: 0,
    example: 'Springfield, IL 62704-1234',
    expect: ['62704-1234'],
  },
  {
    id: 'uk-postcode',
    category: 'Addresses',
    name: 'UK postcode',
    column: 'Postcode',
    description: 'UK postcodes like SW1A 1AA or M1 1AE.',
    pattern: '\\b[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}\\b',
    flags: '',
    group: 0,
    example: '10 Downing Street, London SW1A 2AA',
    expect: ['SW1A 2AA'],
  },
  {
    id: 'in-pin',
    category: 'Addresses',
    name: 'India PIN code',
    column: 'PIN',
    description: '6-digit Indian postal PIN codes (e.g. 560001 or 560 001).',
    pattern: '\\b[1-9]\\d{2} ?\\d{3}\\b',
    flags: '',
    group: 0,
    example: 'MG Road, Bengaluru 560001',
    expect: ['560001'],
  },

  // ----- Business IDs (India) -----
  {
    id: 'gstin',
    category: 'Business IDs (India)',
    name: 'GSTIN',
    column: 'GSTIN',
    description: '15-character GST identification numbers.',
    pattern: '\\b\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\\b',
    flags: '',
    group: 0,
    example: 'Supplier GSTIN: 29ABCDE1234F1Z5',
    expect: ['29ABCDE1234F1Z5'],
  },
  {
    id: 'pan',
    category: 'Business IDs (India)',
    name: 'PAN',
    column: 'PAN',
    description: 'Permanent Account Numbers: 5 letters, 4 digits, 1 letter.',
    pattern: '\\b[A-Z]{5}\\d{4}[A-Z]\\b',
    flags: '',
    group: 0,
    example: 'PAN ABCDE1234F on file',
    expect: ['ABCDE1234F'],
  },
  {
    id: 'ifsc',
    category: 'Business IDs (India)',
    name: 'IFSC (bank branch)',
    column: 'IFSC',
    description: 'Bank branch codes: 4 letters, 0, then 6 letters/digits.',
    pattern: '\\b[A-Z]{4}0[A-Z0-9]{6}\\b',
    flags: '',
    group: 0,
    example: 'IFSC: HDFC0001234',
    expect: ['HDFC0001234'],
  },
  {
    id: 'vehicle-in',
    category: 'Business IDs (India)',
    name: 'Vehicle registration',
    column: 'Vehicle',
    description: 'Indian number plates like KA 01 AB 1234 or MH12DE1433.',
    pattern: '\\b[A-Z]{2}[ -]?\\d{1,2}[ -]?[A-Z]{1,3}[ -]?\\d{4}\\b',
    flags: '',
    group: 0,
    example: 'Vehicles KA 01 AB 1234 and MH12DE1433',
    expect: ['KA 01 AB 1234', 'MH12DE1433'],
  },
];

/** Default fill-in values of a template. */
const defaults = (t: Template): TemplateValues => Object.fromEntries((t.params || []).map((p) => [p.key, p.default]));

/** The rule a template produces (with the given fill-in values). */
function resolve(t: Template, values?: TemplateValues): ResolvedRule {
  const v = { ...defaults(t), ...(values || {}) };
  const built = t.build ? t.build(v) : { pattern: t.pattern || '', column: t.column || '' };
  return { name: built.column || t.column || t.name, pattern: built.pattern, flags: t.flags || '', group: t.group || 0 };
}

/** Quick reference for the admin panel. */
const CHEATSHEET: [token: string, meaning: string][] = [
  ['\\d', 'a digit 0–9'],
  ['\\w', 'a letter, digit or _'],
  ['\\s', 'a space, tab or line break'],
  ['.', 'any character except a line break'],
  ['[abc]  [A-Z]', 'one of these characters / a range'],
  ['[^abc]', 'any character except these'],
  ['+  *  ?', 'one or more / zero or more / optional'],
  ['{3}  {2,5}', 'exactly 3 / between 2 and 5 times'],
  ['( … )', 'a capture group: set "group" to its number to keep only that part'],
  ['(?: … )', 'a group that is not captured'],
  ['a|b', 'a or b'],
  ['^  $', 'start / end of a line (with the m flag)'],
  ['\\b', 'a word boundary, e.g. \\bINV\\b'],
  ['\\.  \\(  \\$', 'a literal . ( $ (escape special characters)'],
  ['flag i', 'ignore upper/lower case'],
  ['flag m', '^ and $ match at every line'],
  ['flag s', '. also matches line breaks'],
];

/** Example text for a template, using the user's fill-in values when it has them. */
function exampleOf(t: Template, values?: TemplateValues): string {
  const v = { ...defaults(t), ...(values || {}) };
  return t.exampleFor && (t.params || []).every((p) => String(v[p.key] || '').trim()) ? t.exampleFor(v) : t.example;
}

const api = { TEMPLATES, resolve, defaults, exampleOf, CHEATSHEET, escapeRegex: esc };

export { TEMPLATES, resolve, defaults, exampleOf, CHEATSHEET, esc as escapeRegex };
export default api;
