/* Shared types for the extraction engine, storage and UI. */

/** Built-in extraction rules. */
export type BuiltinKey = 'email' | 'url' | 'ip' | 'date' | 'amount' | 'phone' | 'hashtag';
/** Built-in rules plus "Key: Value" lines. */
export type FieldKey = BuiltinKey | 'kv';

export type SplitMode = 'auto' | 'whole' | 'line' | 'blank' | 'messages' | 'custom';
/** How a text was actually split (auto mode can also split at repeated labels). */
export type RecordMode = Exclude<SplitMode, 'auto'> | 'labels';
export type MatchMode = 'zip' | 'join';

/** Per-installation settings of a built-in rule. */
export interface FieldConfig {
  enabled: boolean;
  required: boolean;
  /** Column name override. */
  label?: string;
  /** Regex override. */
  pattern?: string;
  /** Regex flags override. */
  flags?: string;
}

/** A rule the user added (from scratch or from a template). */
export interface CustomField {
  id: string;
  /** Column name. */
  name: string;
  pattern: string;
  flags?: string;
  /** Capture group to keep (0 = whole match). */
  group?: number;
  enabled?: boolean;
  required?: boolean;
  /** Template it was made from, if any. */
  template?: string;
}

export interface Settings {
  /** Auto-read the clipboard. */
  enabled: boolean;
  pollInterval: number;
  splitMode: SplitMode;
  delimiter: string;
  matchMode: MatchMode;
  /** In zip mode, copy single-value fields into every row. */
  repeatSingles: boolean;
  /** Spreadsheet / TSV copies become rows directly. */
  detectTables: boolean;
  /** Skip rows identical to one already in the table. */
  dedupeRows: boolean;
  /** Keep the original clipboard text with each row. */
  keepSource: boolean;
  /** Ignore clipboard text shorter than this. */
  minLength: number;
  /** Comma-separated column names to keep, in this order (empty: keep all). */
  keepColumns: string;
  fields: Record<FieldKey, FieldConfig>;
  customFields: CustomField[];
}

/** Settings as they may come from storage or a file: anything can be missing. */
export type SettingsInput = Partial<Omit<Settings, 'fields' | 'customFields'>> & {
  fields?: Partial<Record<FieldKey, Partial<FieldConfig>>>;
  customFields?: CustomField[];
};

/** The extraction part of the settings (what the admin panel edits and projects store). */
export type Rules = Pick<
  Settings,
  | 'splitMode'
  | 'delimiter'
  | 'matchMode'
  | 'repeatSingles'
  | 'detectTables'
  | 'dedupeRows'
  | 'keepSource'
  | 'minLength'
  | 'keepColumns'
  | 'fields'
  | 'customFields'
>;

/** One extracted row: column name → value. */
export type RowData = Record<string, string>;

/** A row stored in the table. */
export interface Row {
  id: string;
  /** Rows from the same clipboard capture share this. */
  clipId: string;
  capturedAt: number;
  data: RowData;
  /** Column order (storage does not keep object key order). */
  cols?: string[];
  source: string;
}

/** Table view choices (per browser). groupBy / sumBy: a column name, '' for none, or 'auto'. */
export interface ViewPrefs {
  groupBy: string;
  sumBy: string;
  /** Phone layout: rows as a table or as cards. */
  mobileView: 'table' | 'cards';
}

/** The project being worked on. */
export interface Project {
  id: string | null;
  name: string;
  createdAt: number;
  savedAt: number | null;
  /** Has changes not saved to Projects. */
  dirty: boolean;
  /** Saved: the next extraction starts a new project. */
  closed: boolean;
}

/** A project saved in the Projects list. */
export interface ProjectDoc {
  id: string;
  name: string;
  createdAt: number;
  savedAt: number;
  rowCount?: number;
  rules: Rules | SettingsInput | null;
  rows: Row[];
}

/** Projects list entry (without rows). */
export type ProjectSummary = Omit<ProjectDoc, 'rows' | 'rules'> & { rowCount: number };

// ---------- extraction trace ----------

export type MatchStatus = 'used' | 'duplicate' | 'skipped' | 'rejected';

/** One value a rule found, and what happened to it. */
export interface Match {
  ruleId: string;
  hue: number;
  /** Column name. */
  label: string;
  value: string;
  /** Position in the full text. */
  start: number;
  end: number;
  status?: MatchStatus;
  note?: string;
}

export interface DroppedRow {
  row: RowData;
  missing: string[];
}

export interface RecordTrace {
  text: string;
  /** Position of the record in the full text. */
  offset: number;
  matches: Match[];
  rows: RowData[];
  dropped: DroppedRow[];
}

export interface RuleError {
  id: string;
  label: string;
  message: string;
}

export interface RuleSummary {
  id: string;
  type: 'kv' | 'custom' | 'builtin';
  label: string;
  hue: number;
  required: boolean;
}

/** Everything `explain()` reports about how a text was turned into rows. */
export interface ExplainResult {
  text: string;
  kind: 'text' | 'table';
  /** How the text was split into records (text kind only). */
  mode: RecordMode | null;
  reason: string;
  records: RecordTrace[];
  rows: RowData[];
  errors: RuleError[];
  rules?: RuleSummary[];
  /** Identical rows removed. */
  duplicateRows: number;
  /** Columns kept by the "only keep these columns" setting, if set. */
  keptColumns: string[] | null;
  /** Why the text was ignored, if it was. */
  ignored: string | null;
}
