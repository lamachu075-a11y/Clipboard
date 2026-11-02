/* Clipboard Extractor – admin panel: edit extraction rules and see how text is extracted. */
(function () {
  'use strict';

  const E = window.ClipExtractor;
  const Store = window.ClipStore;
  const { $, el, toast, saveTextFile, pickTextFile } = window.UI;

  let settings = Store.getSettings();
  let lastResult = null;
  let savingSelf = false;

  const SAMPLES = {
    Contacts:
      'Name: John Smith\nCompany: Acme Corp\nEmail: john@acme.com\nPhone: +91 98765 43210\n\n' +
      'Name: Jane Doe\nCompany: Globex\nEmail: jane@globex.io\nPhone: 020 7946 0958',
    Invoice:
      'Invoice INV-2041 dated 2 Nov 2026\nBill to: Acme Corp\nTotal: $1,250.50\n' +
      'Questions? billing@acme.com or sales@acme.com, +1 (555) 123-4567\nPay online: https://pay.acme.com/inv/2041.',
    List:
      'John Smith  john@acme.com  555-123-4567\nJane Doe  jane@globex.io  555-987-6543\nBob Lee  bob@initech.org\nServer down since 192.168.100.200',
    Spreadsheet: 'Name\tEmail\tCity\nAli\tali@example.com\tDubai\nMei\tmei@example.cn\tShanghai',
  };

  // ---------- saving ----------

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    $('savedMsg').textContent = 'Saving…';
    saveTimer = setTimeout(() => {
      try {
        savingSelf = true;
        Store.saveSettings(settings);
        $('savedMsg').textContent = '✓ Saved';
      } catch (e) {
        $('savedMsg').textContent = '';
        toast(e.message || String(e));
      } finally {
        savingSelf = false;
      }
    }, 300);
    runExplain();
  }

  // ---------- rules list ----------

  const regexError = (pattern, flags) => (pattern ? E.compileCustom({ pattern, flags }).error || '' : '');

  function ruleCard({ id, hue, enabled, onToggle, name, nameEditable, namePlaceholder, onName, tag, pattern, patternEditable, onPattern, flags, onFlags, group, onGroup, required, onRequired, description, actions }) {
    const card = el('div', { className: 'rule' + (enabled ? '' : ' off') });
    card.style.setProperty('--h', hue);
    card.dataset.rule = id;

    const toggle = el('input', { type: 'checkbox', checked: enabled });
    toggle.setAttribute('aria-label', 'Rule on/off');
    toggle.addEventListener('change', () => onToggle(toggle.checked));

    let nameEl;
    if (nameEditable) {
      nameEl = el('input', { type: 'text', className: 'rule-name', value: name, placeholder: namePlaceholder || 'Column name' });
      nameEl.setAttribute('aria-label', 'Column name');
      nameEl.addEventListener('input', () => onName(nameEl.value));
    } else {
      nameEl = el('span', { className: 'rule-name static', textContent: name });
    }

    const top = el('div', { className: 'rule-top' }, [
      el('span', { className: 'swatch' }),
      el('label', { className: 'switch' }, [toggle]),
      nameEl,
      el('span', { className: 'tag', textContent: tag }),
      el('span', { className: 'count', title: 'Values found in the test text' }),
    ]);
    if (onRequired) {
      const req = el('input', { type: 'checkbox', checked: !!required, disabled: !enabled });
      req.addEventListener('change', () => onRequired(req.checked));
      top.append(el('label', { className: 'check req', title: 'Only keep rows that have this column' }, [req, ' Required']));
    }
    top.append(...(actions || []));

    const err = el('div', { className: 'err' });
    const showErr = () => (err.textContent = patternEditable ? regexError(patternInput.value, flagsInput ? flagsInput.value : '') : '');

    const patternInput = el('input', { type: 'text', className: 'mono', value: pattern, readOnly: !patternEditable, spellcheck: false, placeholder: 'regular expression' });
    patternInput.setAttribute('aria-label', 'Regular expression');
    patternInput.addEventListener('input', () => {
      onPattern(patternInput.value);
      showErr();
    });
    const regexRow = el('div', { className: 'rule-regex' }, [el('span', { className: 'slash', textContent: '/' }), patternInput, el('span', { className: 'slash', textContent: '/' })]);

    let flagsInput = null;
    if (onFlags) {
      flagsInput = el('input', { type: 'text', className: 'mono flags', value: flags, spellcheck: false, title: 'Flags: i = ignore case, m = multi-line, s = dot matches newline (g is always on)' });
      flagsInput.setAttribute('aria-label', 'Flags');
      flagsInput.addEventListener('input', () => {
        onFlags(flagsInput.value);
        showErr();
      });
      regexRow.append(flagsInput);
    }
    if (onGroup) {
      const g = el('input', { type: 'number', className: 'group', min: 0, value: group || 0, title: 'Capture group to keep (0 = whole match)' });
      g.setAttribute('aria-label', 'Capture group');
      g.addEventListener('input', () => onGroup(Number(g.value) || 0));
      regexRow.append(el('label', { className: 'group-label' }, ['group ', g]));
    }

    card.append(top, regexRow);
    if (description !== undefined) card.append(el('p', { className: 'desc', textContent: description }));
    card.append(err);
    showErr();
    return card;
  }

  const sectionHead = (title, note) => el('div', { className: 'rules-head' }, [el('h3', { textContent: title }), note ? el('span', { className: 'muted small', textContent: note }) : '']);

  function renderRules() {
    const list = [];

    // 1. Key: Value lines
    const kv = settings.fields.kv;
    list.push(sectionHead('1. Labeled lines', 'run first'));
    list.push(
      ruleCard({
        id: 'kv',
        hue: E.KV_FIELD.hue,
        enabled: kv.enabled,
        onToggle: (v) => change(() => (kv.enabled = v), true),
        name: E.KV_FIELD.label,
        tag: 'built-in',
        pattern: E.KV_FIELD.pattern,
        patternEditable: false,
        description: E.KV_FIELD.description,
      })
    );

    // 2. Custom rules
    list.push(sectionHead('2. Custom rules', 'your own patterns, in this order'));
    if (!settings.customFields.length) {
      list.push(el('p', { className: 'muted small empty-rules', textContent: 'No custom rules yet. Click "+ Add rule" to extract anything else, e.g. order numbers or tracking codes.' }));
    }
    settings.customFields.forEach((cf, i) => {
      const n = settings.customFields.length;
      const move = (d) =>
        el('button', {
          className: 'icon',
          textContent: d < 0 ? '↑' : '↓',
          title: d < 0 ? 'Run earlier' : 'Run later',
          disabled: i + d < 0 || i + d >= n,
          onclick: () =>
            change(() => {
              const arr = settings.customFields;
              [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
            }, true),
        });
      list.push(
        ruleCard({
          id: 'custom:' + cf.id,
          hue: E.CUSTOM_HUES[i % E.CUSTOM_HUES.length],
          enabled: cf.enabled !== false,
          onToggle: (v) => change(() => (cf.enabled = v), true),
          name: cf.name || '',
          nameEditable: true,
          namePlaceholder: 'Column name (required)',
          onName: (v) => change(() => (cf.name = v)) || refreshHint(cf),
          tag: 'custom',
          pattern: cf.pattern || '',
          patternEditable: true,
          onPattern: (v) => change(() => (cf.pattern = v)) || refreshHint(cf),
          flags: cf.flags ?? '',
          onFlags: (v) => change(() => (cf.flags = v)),
          group: cf.group,
          onGroup: (v) => change(() => (cf.group = v)),
          required: cf.required,
          onRequired: (v) => change(() => (cf.required = v)),
          description: customHint(cf),
          actions: [
            move(-1),
            move(1),
            el('button', {
              className: 'icon danger',
              textContent: '✕',
              title: 'Delete rule',
              onclick: () => {
                if (cf.pattern && !confirm(`Delete the rule "${cf.name || 'unnamed'}"?`)) return;
                change(() => (settings.customFields = settings.customFields.filter((x) => x !== cf)), true);
              },
            }),
          ],
        })
      );
    });

    // 3. Built-in rules
    list.push(sectionHead('3. Built-in rules', 'run in this order; each claims the text it matches'));
    for (const f of E.BUILTIN_FIELDS) {
      const cfg = settings.fields[f.key];
      const overridden = cfg.pattern != null || cfg.flags != null || !!cfg.label;
      list.push(
        ruleCard({
          id: f.key,
          hue: f.hue,
          enabled: cfg.enabled,
          onToggle: (v) =>
            change(() => {
              cfg.enabled = v;
              if (!v) cfg.required = false;
            }, true),
          name: cfg.label || '',
          nameEditable: true,
          namePlaceholder: f.label,
          onName: (v) =>
            change(() => {
              const t = v.trim();
              if (!t || t === f.label) delete cfg.label;
              else cfg.label = t;
            }),
          tag: overridden ? 'built-in · edited' : 'built-in',
          pattern: cfg.pattern ?? f.pattern,
          patternEditable: true,
          onPattern: (v) =>
            change(() => {
              if (v === f.pattern || !v) delete cfg.pattern;
              else cfg.pattern = v;
            }),
          flags: cfg.flags ?? f.flags,
          onFlags: (v) =>
            change(() => {
              if (v === f.flags) delete cfg.flags;
              else cfg.flags = v;
            }),
          required: cfg.required,
          onRequired: (v) => change(() => (cfg.required = v)),
          description: f.description,
          actions: overridden
            ? [
                el('button', {
                  className: 'link',
                  textContent: 'Reset',
                  title: 'Restore the default name and pattern',
                  onclick: () =>
                    change(() => {
                      delete cfg.pattern;
                      delete cfg.flags;
                      delete cfg.label;
                    }, true),
                }),
              ]
            : [],
        })
      );
    }
    $('rules').replaceChildren(...list);
    updateCounts();
  }

  const customHint = (cf) => (!String(cf.name || '').trim() || !cf.pattern ? 'Give the rule a column name and a pattern to turn it on.' : '');
  function refreshHint(cf) {
    const desc = $('rules').querySelector(`[data-rule="custom:${cf.id}"] .desc`);
    if (desc) desc.textContent = customHint(cf);
  }

  /** Apply a change; `structural` re-renders the rules list. */
  function change(fn, structural = false) {
    fn();
    if (structural) renderRules();
    save();
  }

  $('addRule').addEventListener('click', () => {
    settings.customFields.push({ id: Store.uid(), name: '', pattern: '', flags: 'i', group: 0, enabled: true, required: false });
    renderRules();
    const card = $('rules').querySelector(`[data-rule="custom:${settings.customFields.at(-1).id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.querySelector('input.rule-name')?.focus();
    save();
  });

  // ---------- options ----------

  function renderOptions() {
    for (const id of ['splitMode', 'matchMode', 'delimiter', 'pollInterval', 'minLength']) $(id).value = settings[id];
    for (const id of ['repeatSingles', 'detectTables', 'dedupeRows', 'keepSource']) $(id).checked = settings[id];
    $('delimiterWrap').hidden = settings.splitMode !== 'custom';
    $('enabled').checked = settings.enabled;
    $('enabledState').textContent = settings.enabled ? 'ON' : 'OFF';
    $('enabledState').closest('.autoread').classList.toggle('on', settings.enabled);
  }
  $('enabled').addEventListener('change', () => {
    settings.enabled = $('enabled').checked;
    renderOptions();
    save();
    toast(settings.enabled ? 'Auto-read is ON' : 'Auto-read is OFF');
  });
  for (const id of ['splitMode', 'matchMode', 'delimiter']) {
    $(id).addEventListener('input', () => {
      settings[id] = $(id).value;
      $('delimiterWrap').hidden = settings.splitMode !== 'custom';
      save();
    });
  }
  for (const id of ['pollInterval', 'minLength']) {
    $(id).addEventListener('change', () => {
      settings[id] = Number($(id).value);
      settings = E.normalizeSettings(settings);
      $(id).value = settings[id];
      save();
    });
  }
  for (const id of ['repeatSingles', 'detectTables', 'dedupeRows', 'keepSource']) {
    $(id).addEventListener('change', () => {
      settings[id] = $(id).checked;
      save();
    });
  }

  // ---------- test & explain ----------

  const STATUS_TEXT = { used: '', duplicate: 'duplicate', skipped: 'skipped', rejected: 'rejected' };

  function highlight(recText, offset, matches) {
    const prio = { used: 0, duplicate: 1, skipped: 2, rejected: 3 };
    const chosen = [];
    for (const m of [...matches].sort((a, b) => prio[a.status] - prio[b.status] || a.start - b.start)) {
      if (!chosen.some((x) => m.start < x.end && x.start < m.end)) chosen.push(m);
    }
    chosen.sort((a, b) => a.start - b.start);
    const out = [];
    let pos = offset;
    for (const m of chosen) {
      if (m.start > pos) out.push(recText.slice(pos - offset, m.start - offset));
      const mark = el('mark', { className: m.status, textContent: recText.slice(m.start - offset, m.end - offset), title: `${m.label}${m.note ? ' · ' + m.note : ''}` });
      mark.style.setProperty('--h', m.hue);
      out.push(mark);
      pos = m.end;
    }
    out.push(recText.slice(pos - offset));
    return el('pre', { className: 'hl' }, out);
  }

  function rowsTable(rows) {
    const cols = [];
    for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
    return el('div', { className: 'preview' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { textContent: c })))]),
        el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => el('td', { textContent: r[c] ?? '' }))))),
      ]),
    ]);
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function runExplain() {
    const text = $('testText').value;
    const r = (lastResult = E.explain(text, settings));
    const out = [];
    const step = (n, title, body) => el('div', { className: 'step' }, [el('div', { className: 'step-n', textContent: n }), el('div', { className: 'step-body' }, [el('b', { textContent: title }), ...body])]);

    for (const e of r.errors) out.push(el('p', { className: 'err', textContent: `Rule "${e.label}": ${e.message}` }));

    if (r.ignored) {
      out.push(el('p', { className: 'muted', textContent: r.ignored }));
    } else if (r.kind === 'table') {
      out.push(step(1, 'Spreadsheet copy', [el('p', { textContent: r.reason })]));
      out.push(step(2, `Result: ${plural(r.rows.length, 'row')}`, [rowsTable(r.rows)]));
    } else {
      out.push(step(1, 'Split into records', [el('p', { textContent: r.reason })]));
      const recs = r.records.map((rec, i) => {
        const chips = rec.matches.map((m) => {
          const chip = el('li', { className: 'chip ' + m.status, title: m.note || '' }, [
            el('span', { className: 'swatch' }),
            el('b', { textContent: m.label }),
            ' ',
            el('span', { className: 'val', textContent: m.value }),
            ...(m.status !== 'used' ? [el('em', { textContent: ` ${STATUS_TEXT[m.status]}${m.note ? ': ' + m.note : ''}` })] : []),
          ]);
          chip.style.setProperty('--h', m.hue);
          return chip;
        });
        const dropped = rec.dropped.map((d) => el('p', { className: 'small warn-text', textContent: `1 row dropped: missing required ${d.missing.join(', ')}` }));
        return el('div', { className: 'record' }, [
          el('div', { className: 'rec-head' }, [
            el('span', { textContent: `Record ${i + 1}` }),
            el('span', { className: 'muted', textContent: `→ ${plural(rec.rows.length, 'row')}` }),
          ]),
          highlight(rec.text, rec.offset, rec.matches),
          chips.length ? el('ul', { className: 'chips' }, chips) : el('p', { className: 'muted small', textContent: 'No rule matched anything in this record.' }),
          ...dropped,
        ]);
      });
      out.push(step(2, 'Run the rules on each record', [el('p', { className: 'muted small', textContent: 'Highlighted text was matched. The chips below list each value and the rule that found it.' }), ...recs]));
      const dup = r.duplicateRows ? ` (${plural(r.duplicateRows, 'duplicate row')} removed)` : '';
      out.push(step(3, `Result: ${plural(r.rows.length, 'row')}${dup}`, r.rows.length ? [rowsTable(r.rows)] : [el('p', { className: 'muted', textContent: 'Nothing would be added to the table.' })]));
    }
    $('explain').replaceChildren(...out);
    updateCounts();
  }

  function updateCounts() {
    if (!lastResult) return;
    const counts = {};
    for (const rec of lastResult.records) for (const m of rec.matches) if (m.status === 'used') counts[m.ruleId] = (counts[m.ruleId] || 0) + 1;
    for (const card of $('rules').querySelectorAll('.rule')) {
      const c = card.querySelector('.count');
      if (card.classList.contains('off')) c.textContent = 'off';
      else if (lastResult.kind === 'table') c.textContent = 'spreadsheet';
      else c.textContent = `${counts[card.dataset.rule] || 0} found`;
      c.classList.toggle('zero', !counts[card.dataset.rule]);
    }
  }

  let draftTimer = null;
  $('testText').addEventListener('input', () => {
    runExplain();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        Store.setDraft($('testText').value);
      } catch {
        /* ignore */
      }
    }, 400);
  });

  $('samples').replaceChildren(
    el('span', { className: 'muted small', textContent: 'Try:' }),
    ...Object.entries(SAMPLES).map(([name, text]) =>
      el('button', {
        className: 'chip-btn',
        textContent: name,
        onclick: () => {
          $('testText').value = text;
          $('testText').dispatchEvent(new Event('input'));
        },
      })
    )
  );

  // ---------- import / export / reset ----------

  $('exportRules').addEventListener('click', async () => {
    const file = { app: 'clipboard-extractor', type: 'rules', version: 1, exportedAt: new Date().toISOString(), rules: E.rulesOf(settings) };
    try {
      const res = await saveTextFile({ suggestedName: 'clipboard-extractor-rules.json', text: JSON.stringify(file, null, 2) });
      if (res) toast(`Rules saved to ${res.fileName}`);
    } catch (e) {
      toast('Could not save: ' + (e?.message || e));
    }
  });

  $('importRules').addEventListener('click', async () => {
    const picked = await pickTextFile($('rulesFile'));
    if (!picked) return;
    let obj;
    try {
      obj = JSON.parse(picked.text);
    } catch {
      return toast('That file is not valid JSON.');
    }
    const rules = obj && obj.app === 'clipboard-extractor' ? obj.rules || obj.settings : null;
    if (!rules) return toast('No extraction rules found in that file.');
    if (!confirm(`Replace all current rules with the rules from "${picked.name}"?`)) return;
    settings = E.normalizeSettings(Object.assign({}, settings, E.rulesOf(rules)));
    renderAll();
    save();
    toast('Rules imported');
  });

  $('resetAll').addEventListener('click', () => {
    if (!confirm('Reset every rule and option to the defaults? Custom rules will be deleted.')) return;
    settings = E.normalizeSettings({ enabled: settings.enabled, pollInterval: settings.pollInterval });
    renderAll();
    save();
    toast('Rules reset to defaults');
  });

  // ---------- regex templates ----------

  const T = window.ClipTemplates;
  let tplCategory = 'All';

  /** Settings that run only one rule (to preview a template on its example). */
  const onlyRule = (rule) => ({
    splitMode: 'whole',
    fields: Object.fromEntries(Object.keys(E.DEFAULT_SETTINGS.fields).map((k) => [k, { enabled: false }])),
    customFields: [Object.assign({ id: 'preview', enabled: true }, rule)],
  });

  /** A column name not used by another custom rule ("Order", "Order 2", …). */
  function freeColumnName(name) {
    const used = new Set(settings.customFields.map((c) => String(c.name || '').trim().toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  function templateCard(t) {
    const values = T.defaults(t);
    const regexEl = el('code', { className: 'tpl-regex' });
    const preview = el('div', { className: 'tpl-preview' });

    function refresh() {
      const rule = T.resolve(t, values);
      regexEl.textContent = `/${rule.pattern}/${rule.flags}${rule.group ? `   · keeps group ${rule.group}` : ''}`;
      const r = E.explain(T.exampleOf(t, values), onlyRule(rule));
      const rec = r.records[0];
      const found = r.rows.map((row) => row[rule.name]).filter(Boolean);
      preview.replaceChildren(
        el('span', { className: 'muted small', textContent: 'Example' }),
        rec ? highlight(rec.text, rec.offset, rec.matches) : el('pre', { className: 'hl', textContent: t.example }),
        el('div', { className: 'tpl-result' }, [
          el('span', { className: 'muted small', textContent: `Extracts into "${rule.name}": ` }),
          ...(found.length
            ? found.map((v) => el('span', { className: 'chip used', textContent: v }))
            : [el('span', { className: 'muted small', textContent: 'nothing in this example' })]),
        ])
      );
      preview.querySelectorAll('mark').forEach((m) => m.style.setProperty('--h', 140));
    }

    const params = (t.params || []).map((p) => {
      const input = el('input', { type: 'text', value: values[p.key], spellcheck: false });
      input.setAttribute('aria-label', p.label);
      input.addEventListener('input', () => {
        values[p.key] = input.value;
        refresh();
      });
      return el('label', { className: 'tpl-param' }, [p.label + ' ', input]);
    });

    const add = el('button', {
      className: 'primary',
      textContent: 'Add rule',
      onclick: () => {
        const rule = T.resolve(t, values);
        if ((t.params || []).some((p) => !String(values[p.key] || '').trim())) return toast('Fill in the template first.');
        const name = freeColumnName(rule.name);
        settings.customFields.push({ id: Store.uid(), name, pattern: rule.pattern, flags: rule.flags, group: rule.group, enabled: true, required: false, template: t.id });
        $('templatesDialog').close();
        renderRules();
        save();
        const card = $('rules').querySelector(`[data-rule="custom:${settings.customFields.at(-1).id}"]`);
        card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card?.classList.add('flash');
        toast(`Added the "${name}" rule. Paste a sample into Test & explain to check it.`);
      },
    });

    refresh();
    return el('div', { className: 'tpl' }, [
      el('div', { className: 'tpl-head' }, [el('b', { textContent: t.name }), el('span', { className: 'tag', textContent: t.category }), add]),
      el('p', { className: 'desc', textContent: t.description }),
      ...(params.length ? [el('div', { className: 'tpl-params' }, params)] : []),
      regexEl,
      preview,
    ]);
  }

  function renderTemplates() {
    const q = $('templateSearch').value.trim().toLowerCase();
    const list = T.TEMPLATES.filter(
      (t) =>
        (tplCategory === 'All' || t.category === tplCategory) &&
        (!q || [t.name, t.category, t.description, t.example].join(' ').toLowerCase().includes(q))
    );
    $('templateList').replaceChildren(
      ...(list.length ? list.map(templateCard) : [el('p', { className: 'muted', textContent: 'No template matches. Try "Text after a label", which works for almost any labeled value.' })])
    );
    const cats = ['All', ...new Set(T.TEMPLATES.map((t) => t.category))];
    $('templateCats').replaceChildren(
      ...cats.map((c) =>
        el('button', {
          className: 'chip-btn' + (c === tplCategory ? ' active' : ''),
          textContent: c,
          onclick: () => {
            tplCategory = c;
            renderTemplates();
          },
        })
      )
    );
  }

  $('addTemplate').addEventListener('click', () => {
    $('templateSearch').value = '';
    tplCategory = 'All';
    renderTemplates();
    $('templatesDialog').showModal();
    $('templateList').scrollTop = 0;
    $('templateSearch').focus();
  });
  $('templateSearch').addEventListener('input', renderTemplates);
  $('closeTemplates').addEventListener('click', () => $('templatesDialog').close());
  $('templatesDialog').addEventListener('click', (e) => e.target === $('templatesDialog') && $('templatesDialog').close());

  $('cheatsheet').replaceChildren(
    ...T.CHEATSHEET.map(([token, meaning]) => el('tr', {}, [el('td', {}, [el('code', { textContent: token })]), el('td', { textContent: meaning })]))
  );

  // ---------- phone layout: tabs ----------

  function showTab(tab) {
    document.querySelector('main.admin').dataset.active = tab;
    document.querySelectorAll('.admin-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  }
  document.querySelectorAll('.admin-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      showTab(b.dataset.tab);
      window.scrollTo({ top: 0 });
    })
  );
  $('templatesDialog').addEventListener('close', () => showTab('rules'));

  // ---------- start ----------

  function renderAll() {
    renderOptions();
    renderRules();
    runExplain();
  }

  // Changes from another tab (e.g. a project opened with its own rules).
  Store.onChange((key) => {
    if (key !== 'settings' || savingSelf) return;
    if (document.activeElement && document.activeElement.closest('.admin') && document.hasFocus()) return;
    settings = Store.getSettings();
    renderAll();
  });

  $('testText').value = Store.getDraft() ?? SAMPLES.Contacts;
  renderAll();
  if (location.hash === '#test') {
    showTab('test');
    setTimeout(() => $('test').scrollIntoView({ block: 'start' }), 50);
    $('testText').focus({ preventScroll: true });
  }
})();
