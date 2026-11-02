'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import type { CustomField, ExplainResult, FieldConfig, Match, MatchStatus, RowData, Settings, SettingsInput } from '../lib/types.ts';
import type { ResolvedRule, Template, TemplateValues } from '../lib/templates.ts';
import { BUILTIN_FIELDS, CUSTOM_HUES, DEFAULT_SETTINGS, KV_FIELD, compileCustom, explain, normalizeSettings, rulesOf } from '../lib/extractor.ts';
import { CHEATSHEET, TEMPLATES, defaults as templateDefaults, exampleOf, resolve as resolveTemplate } from '../lib/templates.ts';
import Store, { uid } from '../lib/store.ts';
import { BASE_PATH, pickTextFile, saveTextFile } from '../lib/files.ts';
import { Modal, ToastProvider, useToast } from './common.tsx';

const SAMPLES: Record<string, string> = {
  Contacts:
    'Name: John Smith\nCompany: Acme Corp\nEmail: john@acme.com\nPhone: +91 98765 43210\n\n' +
    'Name: Jane Doe\nCompany: Globex\nEmail: jane@globex.io\nPhone: 020 7946 0958',
  Invoice:
    'Invoice INV-2041 dated 2 Nov 2026\nBill to: Acme Corp\nTotal: $1,250.50\n' +
    'Questions? billing@acme.com or sales@acme.com, +1 (555) 123-4567\nPay online: https://pay.acme.com/inv/2041.',
  List: 'John Smith  john@acme.com  555-123-4567\nJane Doe  jane@globex.io  555-987-6543\nBob Lee  bob@initech.org\nServer down since 192.168.100.200',
  Spreadsheet: 'Name\tEmail\tCity\nAli\tali@example.com\tDubai\nMei\tmei@example.cn\tShanghai',
  Chat:
    '[02/11, 16:58] K: March 9, 2026\nUsername: mike777\nPlatform: os\nCredit: 5555\nRecharged ✅️\n' +
    '[02/11, 17:02] K: March 10, 2026\nUsername: anna01\nPlatform: android\nCredit: 1200\nRecharged ✅️',
};

const STATUS_TEXT: Record<MatchStatus, string> = { used: '', duplicate: 'duplicate', skipped: 'skipped', rejected: 'rejected' };
type Tab = 'rules' | 'test' | 'settings';
/** CSS custom property for a rule's colour. */
const hueStyle = (hue: number): CSSProperties => ({ '--h': hue }) as CSSProperties;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const regexError = (pattern: string, flags?: string): string => (pattern ? compileCustom({ pattern, flags }).error || '' : '');
const customHint = (cf: CustomField): string => (!String(cf.name || '').trim() || !cf.pattern ? 'Give the rule a column name and a pattern to turn it on.' : '');

/** Settings that run only one rule (to preview a template on its example). */
const onlyRule = (rule: ResolvedRule): SettingsInput => ({
  splitMode: 'whole',
  fields: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.fields).map((k) => [k, { enabled: false }])),
  customFields: [{ id: 'preview', enabled: true, ...rule }],
});

export default function AdminApp() {
  return (
    <ToastProvider>
      <AdminPage />
    </ToastProvider>
  );
}

function AdminPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(() => Store.getSettings());
  const [savedMsg, setSavedMsg] = useState('');
  const [testText, setTestText] = useState(() => Store.getDraft() ?? SAMPLES.Contacts);
  const [tab, setTab] = useState<Tab>('rules');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const savingSelf = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(settings);
  latest.current = settings;

  // Open on the tester when coming from the table's "?" button.
  useEffect(() => {
    if (window.location.hash === '#test') {
      setTab('test');
      setTimeout(() => document.getElementById('test')?.scrollIntoView({ block: 'start' }), 50);
    }
  }, []);

  /** Apply a change to the settings and save it (debounced). */
  const update = useCallback(
    (fn: (s: Settings) => unknown) => {
      setSettings((prev) => {
        const next = normalizeSettings(structuredClone(prev));
        fn(next);
        return next;
      });
      setSavedMsg('Saving…');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          savingSelf.current = true;
          Store.saveSettings(latest.current);
          setSavedMsg('✓ Saved');
        } catch (e) {
          setSavedMsg('');
          toast(e instanceof Error ? e.message : String(e));
        } finally {
          savingSelf.current = false;
        }
      }, 300);
    },
    [toast]
  );

  // Changes from another tab (e.g. a project opened with its own rules).
  useEffect(
    () =>
      Store.onChange((key) => {
        if (key !== 'settings' || savingSelf.current) return;
        if (document.hasFocus() && document.activeElement?.closest('.admin')) return;
        setSettings(Store.getSettings());
      }),
    []
  );

  // Keep the test text between visits.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        Store.setDraft(testText);
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [testText]);

  const result = useMemo(() => explain(testText, settings), [testText, settings]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const rec of result.records) for (const m of rec.matches) if (m.status === 'used') c[m.ruleId] = (c[m.ruleId] || 0) + 1;
    return c;
  }, [result]);
  const countFor = (id: string, enabled: boolean): string => (!enabled ? 'off' : result.kind === 'table' ? 'spreadsheet' : `${counts[id] || 0} found`);

  // ---------- rules ----------

  const addRule = (rule: Partial<CustomField> = {}): string => {
    const id = uid();
    update((s) => s.customFields.push({ id, name: '', pattern: '', flags: 'i', group: 0, enabled: true, required: false, ...rule }));
    setTab('rules');
    setFlashId(id);
    setTimeout(() => {
      const card = document.querySelector(`[data-rule="custom:${id}"]`);
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (!rule.name) card?.querySelector<HTMLInputElement>('input.rule-name')?.focus();
    }, 50);
    return id;
  };

  const exportRules = async () => {
    const file = { app: 'clipboard-extractor', type: 'rules', version: 1, exportedAt: new Date().toISOString(), rules: rulesOf(settings) };
    try {
      const res = await saveTextFile({ suggestedName: 'clipboard-extractor-rules.json', text: JSON.stringify(file, null, 2) });
      if (res) toast(`Rules saved to ${res.fileName}`);
    } catch (e) {
      toast('Could not save: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const importRules = async () => {
    const picked = await pickTextFile();
    if (!picked) return;
    let obj: { app?: string; rules?: SettingsInput; settings?: SettingsInput } | null;
    try {
      obj = JSON.parse(picked.text);
    } catch {
      return toast('That file is not valid JSON.');
    }
    const rules = obj && obj.app === 'clipboard-extractor' ? obj.rules || obj.settings : null;
    if (!rules) return toast('No extraction rules found in that file.');
    if (!confirm(`Replace all current rules with the rules from "${picked.name}"?`)) return;
    update((s) => Object.assign(s, normalizeSettings({ ...s, ...rulesOf(rules) })));
    toast('Rules imported');
  };

  const resetAll = () => {
    if (!confirm('Reset every rule and option to the defaults? Custom rules will be deleted.')) return;
    update((s) => Object.assign(s, normalizeSettings({ enabled: s.enabled, pollInterval: s.pollInterval })));
    toast('Rules reset to defaults');
  };

  const kv = settings.fields.kv;

  return (
    <div className="admin-page">
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE_PATH}/icons/icon32.png`} alt="" width="24" height="24" />
          <h1>Admin panel</h1>
          <span className="muted small-inline">Extraction rules</span>
          <span className="save-state saved" id="savedMsg" role="status">
            {savedMsg}
          </span>
        </div>
        <div className="tools">
          <button id="exportRules" title="Download all rules and options as one file" onClick={exportRules}>
            Export rules
          </button>
          <button id="importRules" title="Load rules from a rules file or a project file" onClick={importRules}>
            Import rules
          </button>
          <button id="resetAll" className="danger" onClick={resetAll}>
            Reset to defaults
          </button>
          <Link className="btn primary" href="/">
            ← Back to table
          </Link>
        </div>
      </header>

      <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
        {([
          ['rules', 'Rules'],
          ['test', 'Test & explain'],
          ['settings', 'Settings'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            data-tab={key}
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              window.scrollTo({ top: 0 });
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="admin" data-active={tab}>
        <div className="admin-grid">
          <div className="admin-col">
            <section className="card" data-tab="rules">
              <h2>How text is extracted</h2>
              <ol className="how">
                <li>
                  <b>Spreadsheet check.</b> If every line has the same number of tabs (a copy from Excel or Sheets), each line becomes a row and the rules below are not
                  used.
                </li>
                <li>
                  <b>Split into records.</b> The text is cut into records (see <a href="#records">Records &amp; rows</a>). Each record can produce one or more rows.
                </li>
                <li>
                  <b>Run the rules</b>, top to bottom: <i>Key: Value lines</i>, then your <i>custom rules</i>, then the <i>built-in rules</i>. Each rule&apos;s matches go
                  into its column. A built-in rule <i>claims</i> the text it matched, so a later rule can&apos;t use it again (digits inside a date never become a phone
                  number).
                </li>
                <li>
                  <b>Build rows.</b> If a column found several values in one record, each value gets its own row; or they&apos;re joined into one cell.
                </li>
                <li>
                  <b>Filter.</b> Rows missing a <i>required</i> column are dropped, and rows already in the table are skipped.
                </li>
              </ol>
              <p className="muted small">
                All rules are saved automatically in this browser and used by the table right away. Every saved project also contains a copy of the rules it was made
                with.
              </p>
            </section>

            <section className="card" data-tab="rules">
              <div className="card-head">
                <h2>Extraction rules</h2>
                <div className="row">
                  <button id="addTemplate" className="primary" title="Pick a ready-made regex" onClick={() => setTemplatesOpen(true)}>
                    Add from template
                  </button>
                  <button id="addRule" title="Write your own regex" onClick={() => addRule()}>
                    + Blank rule
                  </button>
                </div>
              </div>
              <p className="muted small">
                Each rule is a{' '}
                <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions" target="_blank" rel="noopener noreferrer">
                  regular expression
                </a>
                . The count shows how many values it finds in the test text. Use a capture group to keep only part of a match, e.g. <code>Order #(\d+)</code> with
                group 1 keeps just the number.
              </p>
              <details className="cheats">
                <summary>Regex quick reference</summary>
                <table id="cheatsheet">
                  <tbody>
                    {CHEATSHEET.map(([token, meaning]) => (
                      <tr key={token}>
                        <td>
                          <code>{token}</code>
                        </td>
                        <td>{meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <div id="rules" className="rules">
                <RulesHead title="1. Labeled lines" note="run first" />
                <RuleCard
                  id="kv"
                  hue={KV_FIELD.hue}
                  enabled={kv.enabled}
                  onToggle={(v) => update((s) => (s.fields.kv.enabled = v))}
                  name={KV_FIELD.label}
                  tag="built-in"
                  pattern={KV_FIELD.pattern}
                  description={KV_FIELD.description}
                  count={countFor('kv', kv.enabled)}
                  zero={!counts.kv}
                />

                <RulesHead title="2. Custom rules" note="your own patterns, in this order" />
                {!settings.customFields.length ? (
                  <p className="muted small empty-rules">No custom rules yet. Click &quot;Add from template&quot; or &quot;+ Blank rule&quot; to extract anything else.</p>
                ) : null}
                {settings.customFields.map((cf, i) => {
                  const n = settings.customFields.length;
                  const at = (fn: (c: CustomField) => unknown) =>
                    update((s) => {
                      const c = s.customFields.find((x) => x.id === cf.id);
                      if (c) fn(c);
                    });
                  const move = (d: number) =>
                    update((s) => {
                      const arr = s.customFields;
                      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
                    });
                  return (
                    <RuleCard
                      key={cf.id}
                      id={'custom:' + cf.id}
                      flash={flashId === cf.id}
                      hue={CUSTOM_HUES[i % CUSTOM_HUES.length]}
                      enabled={cf.enabled !== false}
                      onToggle={(v) => at((c) => (c.enabled = v))}
                      name={cf.name || ''}
                      namePlaceholder="Column name (required)"
                      onName={(v) => at((c) => (c.name = v))}
                      tag="custom"
                      pattern={cf.pattern || ''}
                      onPattern={(v) => at((c) => (c.pattern = v))}
                      flags={cf.flags ?? ''}
                      onFlags={(v) => at((c) => (c.flags = v))}
                      group={cf.group}
                      onGroup={(v) => at((c) => (c.group = v))}
                      required={cf.required}
                      onRequired={(v) => at((c) => (c.required = v))}
                      description={customHint(cf)}
                      count={countFor('custom:' + cf.id, cf.enabled !== false)}
                      zero={!counts['custom:' + cf.id]}
                      actions={
                        <>
                          <button className="icon" title="Run earlier" disabled={i === 0} onClick={() => move(-1)}>
                            ↑
                          </button>
                          <button className="icon" title="Run later" disabled={i === n - 1} onClick={() => move(1)}>
                            ↓
                          </button>
                          <button
                            className="icon danger"
                            title="Delete rule"
                            onClick={() => {
                              if (cf.pattern && !confirm(`Delete the rule "${cf.name || 'unnamed'}"?`)) return;
                              update((s) => (s.customFields = s.customFields.filter((x) => x.id !== cf.id)));
                            }}
                          >
                            ✕
                          </button>
                        </>
                      }
                    />
                  );
                })}

                <RulesHead title="3. Built-in rules" note="run in this order; each claims the text it matches" />
                {BUILTIN_FIELDS.map((f) => {
                  const cfg = settings.fields[f.key];
                  const overridden = cfg.pattern != null || cfg.flags != null || !!cfg.label;
                  const at = (fn: (c: FieldConfig) => unknown) => update((s) => fn(s.fields[f.key]));
                  return (
                    <RuleCard
                      key={f.key}
                      id={f.key}
                      hue={f.hue}
                      enabled={cfg.enabled}
                      onToggle={(v) =>
                        at((c) => {
                          c.enabled = v;
                          if (!v) c.required = false;
                        })
                      }
                      name={cfg.label || ''}
                      namePlaceholder={f.label}
                      onName={(v) =>
                        at((c) => {
                          const t = v.trim();
                          if (!t || t === f.label) delete c.label;
                          else c.label = v;
                        })
                      }
                      tag={overridden ? 'built-in · edited' : 'built-in'}
                      pattern={cfg.pattern ?? f.pattern}
                      onPattern={(v) =>
                        at((c) => {
                          if (v === f.pattern || !v) delete c.pattern;
                          else c.pattern = v;
                        })
                      }
                      flags={cfg.flags ?? f.flags}
                      onFlags={(v) =>
                        at((c) => {
                          if (v === f.flags) delete c.flags;
                          else c.flags = v;
                        })
                      }
                      required={cfg.required}
                      onRequired={(v) => at((c) => (c.required = v))}
                      description={f.description}
                      count={countFor(f.key, cfg.enabled)}
                      zero={!counts[f.key]}
                      actions={
                        overridden ? (
                          <button
                            className="link"
                            title="Restore the default name and pattern"
                            onClick={() =>
                              at((c) => {
                                delete c.pattern;
                                delete c.flags;
                                delete c.label;
                              })
                            }
                          >
                            Reset
                          </button>
                        ) : null
                      }
                    />
                  );
                })}
              </div>
            </section>

            <section className="card" data-tab="settings" id="records">
              <h2>Records &amp; rows</h2>
              <label className="field">
                Split records by
                <select id="splitMode" value={settings.splitMode} onChange={(e) => update((s) => (s.splitMode = e.target.value as Settings['splitMode']))}>
                  <option value="auto">Auto-detect</option>
                  <option value="whole">Whole text is one record</option>
                  <option value="line">Each line</option>
                  <option value="blank">Blank lines (paragraphs)</option>
                  <option value="messages">Chat messages (WhatsApp &quot;[date, time] Name:&quot;)</option>
                  <option value="custom">Custom delimiter</option>
                </select>
              </label>
              {settings.splitMode === 'custom' ? (
                <label className="field" id="delimiterWrap">
                  Delimiter
                  <input type="text" id="delimiter" placeholder="---  (\n = newline, \t = tab)" value={settings.delimiter} onChange={(e) => update((s) => (s.delimiter = e.target.value))} />
                </label>
              ) : null}
              <label className="field-col" htmlFor="keepColumns">
                Only keep these columns
                <input
                  type="text"
                  id="keepColumns"
                  placeholder="e.g. Date, Platform, Credit   (empty: keep all)"
                  value={settings.keepColumns}
                  onChange={(e) => update((s) => (s.keepColumns = e.target.value))}
                />
              </label>
              <p className="muted small">Column names separated by commas, in the order you want them. Other columns are left out of the table and downloads.</p>
              <label className="field">
                Several values in one record
                <select id="matchMode" value={settings.matchMode} onChange={(e) => update((s) => (s.matchMode = e.target.value as Settings['matchMode']))}>
                  <option value="zip">One row per value</option>
                  <option value="join">Join into one cell</option>
                </select>
              </label>
              <Check id="repeatSingles" checked={settings.repeatSingles} onChange={(v) => update((s) => (s.repeatSingles = v))}>
                Repeat single values on every row of a record
              </Check>
              <Check id="detectTables" checked={settings.detectTables} onChange={(v) => update((s) => (s.detectTables = v))}>
                Spreadsheet copies (tab-separated) become rows
              </Check>
            </section>

            <section className="card" data-tab="settings">
              <h2>Capture</h2>
              <label className={'autoread' + (settings.enabled ? ' on' : '')} title="When ON, new clipboard text is read and extracted automatically">
                <input
                  type="checkbox"
                  id="enabled"
                  role="switch"
                  checked={settings.enabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    update((s) => (s.enabled = v));
                    toast(v ? 'Auto-read is ON' : 'Auto-read is OFF');
                  }}
                />
                <span className="autoread-label">Auto-read clipboard</span>
                <span className="autoread-state" id="enabledState">
                  {settings.enabled ? 'ON' : 'OFF'}
                </span>
              </label>
              <p className="muted small">
                When ON, the table page reads new clipboard text automatically whenever you switch to it. When OFF, nothing is read until you paste on the page or click
                &quot;Read clipboard&quot;.
              </p>
              <Check id="dedupeRows" checked={settings.dedupeRows} onChange={(v) => update((s) => (s.dedupeRows = v))}>
                Skip rows already in the table
              </Check>
              <Check id="keepSource" checked={settings.keepSource} onChange={(v) => update((s) => (s.keepSource = v))}>
                Keep the original text with each row
              </Check>
              <NumberField id="pollInterval" label="Check the clipboard every" unit="ms" min={250} step={250} value={settings.pollInterval} onChange={(v) => update((s) => (s.pollInterval = v))} />
              <NumberField id="minLength" label="Ignore text shorter than" unit="characters" min={0} value={settings.minLength} onChange={(v) => update((s) => (s.minLength = v))} />
            </section>
          </div>

          <div className="admin-col sticky" id="test">
            <section className="card" data-tab="test">
              <div className="card-head">
                <h2>Test &amp; explain</h2>
                <div className="samples" id="samples">
                  <span className="muted small">Try:</span>
                  {Object.entries(SAMPLES).map(([name, text]) => (
                    <button key={name} className="chip-btn" onClick={() => setTestText(text)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <textarea id="testText" rows={8} aria-label="Test text" placeholder="Paste any text to see how it is extracted" value={testText} onChange={(e) => setTestText(e.target.value)} />
              <Explanation result={result} />
            </section>
          </div>
        </div>
      </main>

      <TemplatesDialog
        open={templatesOpen}
        onClose={() => {
          setTemplatesOpen(false);
          setTab('rules');
        }}
        usedNames={settings.customFields.map((c) => String(c.name || '').trim().toLowerCase())}
        onAdd={(rule: ResolvedRule, templateId: string) => {
          setTemplatesOpen(false);
          addRule({ ...rule, template: templateId });
          toast(`Added the "${rule.name}" rule. Paste a sample into Test & explain to check it.`);
        }}
      />
    </div>
  );
}

// ---------- small form parts ----------

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" id={id} checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  );
}

/** Number input that only saves valid values when you leave it. */
type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  id: string;
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
};

function NumberField({ id, label, unit, value, onChange, ...rest }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field">
      {label}
      <span>
        <input
          type="number"
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (Number.isFinite(n)) onChange(n);
            else setText(String(value));
          }}
          {...rest}
        />{' '}
        {unit}
      </span>
    </label>
  );
}

function RulesHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="rules-head">
      <h3>{title}</h3>
      {note ? <span className="muted small">{note}</span> : null}
    </div>
  );
}

interface RuleCardProps {
  id: string;
  hue: number;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  name: string;
  namePlaceholder?: string;
  /** Without it the name is shown, not editable. */
  onName?: (name: string) => void;
  tag: string;
  pattern: string;
  /** Without it the pattern is read-only. */
  onPattern?: (pattern: string) => void;
  flags?: string;
  onFlags?: (flags: string) => void;
  group?: number;
  onGroup?: (group: number) => void;
  required?: boolean;
  onRequired?: (required: boolean) => void;
  description?: string;
  /** "3 found", "off", … */
  count: string;
  zero: boolean;
  actions?: ReactNode;
  flash?: boolean;
}

function RuleCard({ id, hue, enabled, onToggle, name, namePlaceholder, onName, tag, pattern, onPattern, flags, onFlags, group, onGroup, required, onRequired, description, count, zero, actions, flash }: RuleCardProps) {
  const err = onPattern ? regexError(pattern, onFlags ? flags : '') : '';
  return (
    <div className={'rule' + (enabled ? '' : ' off') + (flash ? ' flash' : '')} data-rule={id} style={hueStyle(hue)}>
      <div className="rule-top">
        <span className="swatch" />
        <label className="switch">
          <input type="checkbox" checked={enabled} aria-label="Rule on/off" onChange={(e) => onToggle(e.target.checked)} />
        </label>
        {onName ? (
          <input type="text" className="rule-name" value={name} placeholder={namePlaceholder || 'Column name'} aria-label="Column name" onChange={(e) => onName(e.target.value)} />
        ) : (
          <span className="rule-name static">{name}</span>
        )}
        <span className="tag">{tag}</span>
        <span className={'count' + (zero ? ' zero' : '')} title="Values found in the test text">
          {count}
        </span>
        {onRequired ? (
          <label className="check req" title="Only keep rows that have this column">
            <input type="checkbox" checked={!!required} disabled={!enabled} onChange={(e) => onRequired(e.target.checked)} /> Required
          </label>
        ) : null}
        {actions}
      </div>
      <div className="rule-regex">
        <span className="slash">/</span>
        <input
          type="text"
          className="mono"
          value={pattern}
          readOnly={!onPattern}
          spellCheck={false}
          placeholder="regular expression"
          aria-label="Regular expression"
          onChange={(e) => onPattern?.(e.target.value)}
        />
        <span className="slash">/</span>
        {onFlags ? (
          <input
            type="text"
            className="mono flags"
            value={flags}
            spellCheck={false}
            aria-label="Flags"
            title="Flags: i = ignore case, m = multi-line, s = dot matches newline (g is always on)"
            onChange={(e) => onFlags(e.target.value)}
          />
        ) : null}
        {onGroup ? (
          <label className="group-label">
            group{' '}
            <input type="number" className="group" min={0} value={group || 0} aria-label="Capture group" title="Capture group to keep (0 = whole match)" onChange={(e) => onGroup(Number(e.target.value) || 0)} />
          </label>
        ) : null}
      </div>
      {description !== undefined ? <p className="desc">{description}</p> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}

// ---------- test & explain ----------

/** Record text with the matched parts highlighted (one highlight per character). */
function Highlight({ text, offset, matches, hue }: { text: string; offset: number; matches: Match[]; hue?: number }) {
  const prio: Record<MatchStatus, number> = { used: 0, duplicate: 1, skipped: 2, rejected: 3 };
  const rank = (m: Match): number => prio[m.status || 'used'];
  const chosen: Match[] = [];
  for (const m of [...matches].sort((a, b) => rank(a) - rank(b) || a.start - b.start)) {
    if (!chosen.some((x) => m.start < x.end && x.start < m.end)) chosen.push(m);
  }
  chosen.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = offset;
  chosen.forEach((m, i) => {
    if (m.start > pos) out.push(text.slice(pos - offset, m.start - offset));
    out.push(
      <mark key={i} className={m.status} title={`${m.label}${m.note ? ' · ' + m.note : ''}`} style={hueStyle(hue ?? m.hue)}>
        {text.slice(m.start - offset, m.end - offset)}
      </mark>
    );
    pos = m.end;
  });
  out.push(text.slice(pos - offset));
  return <pre className="hl">{out}</pre>;
}

function RowsTable({ rows }: { rows: RowData[] }) {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return (
    <div className="preview">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{r[c] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="step">
      <div className="step-n">{n}</div>
      <div className="step-body">
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

/** Says which columns the "Only keep these columns" setting keeps. */
function KeptNote({ cols }: { cols: string[] | null }) {
  if (!cols) return null;
  return <p className="muted small">Only keeping the columns: {cols.join(', ')} (set in Settings → Records &amp; rows).</p>;
}

function Explanation({ result: r }: { result: ExplainResult }) {
  const errors = r.errors.map((e) => (
    <p key={e.id} className="err">
      Rule &quot;{e.label}&quot;: {e.message}
    </p>
  ));
  if (r.ignored) {
    return (
      <div id="explain" className="explain">
        {errors}
        <p className="muted">{r.ignored}</p>
      </div>
    );
  }
  if (r.kind === 'table') {
    return (
      <div id="explain" className="explain">
        {errors}
        <Step n={1} title="Spreadsheet copy">
          <p>{r.reason}</p>
        </Step>
        <Step n={2} title={`Result: ${plural(r.rows.length, 'row')}`}>
          <KeptNote cols={r.keptColumns} />
          <RowsTable rows={r.rows} />
        </Step>
      </div>
    );
  }
  const dup = r.duplicateRows ? ` (${plural(r.duplicateRows, 'duplicate row')} removed)` : '';
  return (
    <div id="explain" className="explain">
      {errors}
      <Step n={1} title="Split into records">
        <p>{r.reason}</p>
      </Step>
      <Step n={2} title="Run the rules on each record">
        <p className="muted small">Highlighted text was matched. The chips below list each value and the rule that found it.</p>
        {r.records.map((rec, i) => (
          <div key={i} className="record">
            <div className="rec-head">
              <span>Record {i + 1}</span>
              <span className="muted">→ {plural(rec.rows.length, 'row')}</span>
            </div>
            <Highlight text={rec.text} offset={rec.offset} matches={rec.matches} />
            {rec.matches.length ? (
              <ul className="chips">
                {rec.matches.map((m, j) => (
                  <li key={j} className={'chip ' + m.status} title={m.note || ''} style={hueStyle(m.hue)}>
                    <span className="swatch" />
                    <b>{m.label}</b> <span className="val">{m.value}</span>
                    {m.status !== 'used' ? <em>{` ${STATUS_TEXT[m.status || 'used']}${m.note ? ': ' + m.note : ''}`}</em> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No rule matched anything in this record.</p>
            )}
            {rec.dropped.map((d, j) => (
              <p key={j} className="small warn-text">
                1 row dropped: missing required {d.missing.join(', ')}
              </p>
            ))}
          </div>
        ))}
      </Step>
      <Step n={3} title={`Result: ${plural(r.rows.length, 'row')}${dup}`}>
        <KeptNote cols={r.keptColumns} />
        {r.rows.length ? <RowsTable rows={r.rows} /> : <p className="muted">Nothing would be added to the table.</p>}
      </Step>
    </div>
  );
}

// ---------- regex templates ----------

interface TemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  /** Column names of existing custom rules (lower case). */
  usedNames: string[];
  onAdd: (rule: ResolvedRule, templateId: string) => void;
}

function TemplatesDialog({ open, onClose, usedNames, onAdd }: TemplatesDialogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  useEffect(() => {
    if (open) {
      setQuery('');
      setCategory('All');
    }
  }, [open]);
  const q = query.trim().toLowerCase();
  const list = TEMPLATES.filter((t) => (category === 'All' || t.category === category) && (!q || [t.name, t.category, t.description, t.example].join(' ').toLowerCase().includes(q)));
  const cats = ['All', ...new Set(TEMPLATES.map((t) => t.category))];

  /** A column name not used by another custom rule ("Order", "Order 2", …). */
  const freeName = (name: string): string => {
    const used = new Set(usedNames);
    if (!used.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  };

  return (
    <Modal open={open} onClose={onClose} className="wide" id="templatesDialog">
      <div className="dialog-head">
        <h2>Regex templates</h2>
        <button className="icon" id="closeTemplates" title="Close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="muted small">
        Pick a template to add it as a custom rule. Fill-in templates let you type your own label. The example shows exactly what the rule extracts, and you can edit
        the rule afterwards.
      </p>
      <div className="tpl-filter">
        <input type="search" id="templateSearch" autoFocus placeholder="Search templates, e.g. invoice, time, postcode…" aria-label="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="samples" id="templateCats">
          {cats.map((c) => (
            <button key={c} className={'chip-btn' + (c === category ? ' active' : '')} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div id="templateList" className="tpl-list">
        {list.length ? (
          list.map((t) => <TemplateCard key={t.id} template={t} onAdd={(rule) => onAdd({ ...rule, name: freeName(rule.name) }, t.id)} />)
        ) : (
          <p className="muted">No template matches. Try &quot;Text after a label&quot;, which works for almost any labeled value.</p>
        )}
      </div>
    </Modal>
  );
}

function TemplateCard({ template: t, onAdd }: { template: Template; onAdd: (rule: ResolvedRule) => void }) {
  const [values, setValues] = useState<TemplateValues>(() => templateDefaults(t));
  const rule = resolveTemplate(t, values);
  const r = explain(exampleOf(t, values), onlyRule(rule));
  const rec = r.records[0];
  const found = r.rows.map((row) => row[rule.name]).filter(Boolean);
  const filled = (t.params || []).every((p) => String(values[p.key] || '').trim());
  return (
    <div className="tpl">
      <div className="tpl-head">
        <b>{t.name}</b>
        <span className="tag">{t.category}</span>
        <button className="primary" disabled={!filled} onClick={() => onAdd({ name: rule.name, pattern: rule.pattern, flags: rule.flags, group: rule.group })}>
          Add rule
        </button>
      </div>
      <p className="desc">{t.description}</p>
      {t.params ? (
        <div className="tpl-params">
          {t.params.map((p) => (
            <label key={p.key} className="tpl-param">
              {p.label}{' '}
              <input type="text" value={values[p.key]} spellCheck={false} aria-label={p.label} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} />
            </label>
          ))}
        </div>
      ) : null}
      <code className="tpl-regex">{`/${rule.pattern}/${rule.flags}${rule.group ? `   · keeps group ${rule.group}` : ''}`}</code>
      <div className="tpl-preview">
        <span className="muted small">Example</span>
        {rec ? <Highlight text={rec.text} offset={rec.offset} matches={rec.matches} hue={140} /> : <pre className="hl">{exampleOf(t, values)}</pre>}
        <div className="tpl-result">
          <span className="muted small">Extracts into &quot;{rule.name}&quot;: </span>
          {found.length ? (
            found.map((v, i) => (
              <span key={i} className="chip used">
                {v}
              </span>
            ))
          ) : (
            <span className="muted small">nothing in this example</span>
          )}
        </div>
      </div>
    </div>
  );
}
