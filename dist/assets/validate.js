/* FARO — validation harness.
   Depends on assets/data.js (window.FARO) and assets/breaks.js (window.FARO_BREAKS).
   Runs once on load. Every later statistic on the desk goes through here first:
   a ratio the harness cannot defend is null, never a plausible-looking number. */
(function () {
  'use strict';

  const D = window.FARO, RG = window.FARO_BREAKS;
  if (!D || !RG) { console.error('FARO audit: dataset or register missing'); return; }
  const P = D.periods, B = D.banks, LAST = P.length - 1;

  const RULE = {};
  RG.rules.forEach(r => { RULE[r.id] = r; });

  const codes = { credit_break: 1, credit_zero: 1, nim_regime: 1, cor_floor: 1, eff_cap: 1 };
  const findings = [];
  const byKey = new Map();          // bankId|field|i -> strongest finding

  function add(ruleId, bank, i, field, value, msg, fields) {
    const rule = RULE[ruleId];
    if (!rule) return;
    const f = {
      rule: ruleId, cls: rule.class, sev: rule.severity, title: rule.title,
      decision: rule.decision,
      bankId: bank ? bank.id : null, bank: bank ? bank.name : 'System',
      i, q: i == null ? null : P[i], field: field || rule.field,
      value, msg: msg || rule.title, fields: fields || null
    };
    findings.push(f);
    if (bank && field && i != null) {
      const k = bank.id + '|' + field + '|' + i;
      const prev = byKey.get(k);
      if (!prev || rank(f) > rank(prev)) byKey.set(k, f);
    }
    return f;
  }
  const rank = f => (f.sev === 'error' ? 3 : f.sev === 'warn' ? 2 : 1);

  /* ---------- series segments ---------- */
  const segs = {};   // field -> Map bankId -> [start indices]
  function segment(field, bankId) { return (segs[field] && segs[field].get(bankId)) || [0]; }
  function crosses(field, bankId, i) {
    return segment(field, bankId).indexOf(i) > 0;
  }

  function buildSegments(field, isBreak) {
    const m = new Map();
    B.forEach(b => {
      const starts = [0];
      for (let i = 1; i < P.length; i++) if (isBreak(b, i)) starts.push(i);
      m.set(b.id, starts);
    });
    segs[field] = m;
  }

  /* ---------- rules ---------- */
  B.forEach(b => {
    const has = k => b[k] && b[k].some(v => v != null);

    /* 1 · credit book redefinition — assets barely move, the book halves */
    for (let i = 1; i < P.length; i++) {
      const prev = b.cr[i - 1], now = b.cr[i];
      if (prev == null || prev <= 0.5) continue;
      if (now === 0) {
        add('credit_zero', b, i, 'cr', now,
          `Credit book goes to exactly zero while deposits keep reporting.`);
      } else if (now != null) {
        const r = now / prev, a0 = b.a[i - 1], a1 = b.a[i];
        const assetMove = a0 && a1 ? Math.abs(a1 / a0 - 1) : 0;
        if (r < 0.8 || r > 1.25) {
          add('credit_break', b, i, 'cr', now,
            `Credit book ${(r * 100).toFixed(1)}% of the prior print while assets move ${assetMove < 0.005 ? 'less than 0.5%' : (assetMove * 100).toFixed(1) + '%'}.`);
        }
      }
    }

    /* 2 · margin regime change */
    for (let i = 1; i < P.length; i++) {
      const p = b.nim[i - 1], n = b.nim[i];
      if (p == null || n == null) continue;
      const d = Math.abs(n - p);
      const r = Math.abs(p) > 0.002 ? n / p : null;
      if (d > 0.03 && (r == null || r > 2 || r < 0.5)) {
        add('nim_regime', b, i, 'nim', n,
          `Margin ${(p * 100).toFixed(1)}% → ${(n * 100).toFixed(1)}% in one quarter: ${r == null ? 'from a negative base' : (r * 100).toFixed(0) + '% of the prior print'}.`);
      }
    }

    /* 3 · impossible provision charge */
    b.cor.forEach((v, i) => {
      if (v != null && v < -0.02) {
        add('cor_floor', b, i, 'cor', v,
          `Provision charge of ${(v * 100).toFixed(1)}% of the credit book — a release larger than the book cannot be right.`);
      }
    });

    /* 4 · efficiency off the scale */
    b.eff.forEach((v, i) => {
      if (v != null && v > 1.5) {
        add('eff_cap', b, i, 'eff', v, `Operating expenses at ${(v * 100).toFixed(0)}% of operating income.`);
      }
      if (v != null && v < 0.2) {
        add('structural_eff', b, i, 'eff', v, `Efficiency of ${(v * 100).toFixed(1)}% — a development bank or a float-funded book, not a misprint.`);
      }
    });

    /* 5 · ROE tie-out against closing equity */
    b.roe.forEach((v, i) => {
      if (v == null || b.ni[i] == null || !b.eq[i]) return;
      const impl = b.ni[i] / b.eq[i];
      if (Math.abs(v - impl) > 0.05) {
        add('method_roe', b, i, 'roe', v,
          `Reported ${(v * 100).toFixed(1)}% against ${(impl * 100).toFixed(1)}% on closing equity.`);
      }
    });

    /* 6 · leverage outside the bank band */
    b.eq.forEach((v, i) => {
      if (v == null || !b.a[i]) return;
      const r = v / b.a[i];
      if (r > 0.25) add('structural_leverage', b, i, 'eq', r,
        `Equity is ${(r * 100).toFixed(1)}% of assets.`);
    });

    /* 7 · margin against the same quarter a year earlier */
    for (let i = 4; i < P.length; i++) {
      const prev = b.nim[i - 4], now = b.nim[i];
      if (prev == null || now == null || prev === 0) continue;
      const r = now / prev;
      if ((r < 0.45 || r > 2.2) && Math.abs(now - prev) > 0.01) {
        add('nim_yoy', b, i, 'nim', now,
          `Margin ${(now * 100).toFixed(2)}% against ${(prev * 100).toFixed(2)}% a year earlier (${(r * 100).toFixed(0)}%).`);
      }
    }

    /* 8 · missing prints, interior and at the edge */
    const missFields = ['a', 'cr', 'eq', 'ni', 'dep', 'roe', 'roa', 'nim', 'cor', 'cov', 'eff'];
    const live = b.a.map((v, i) => v != null || b.ni[i] != null || b.eq[i] != null);
    const first = live.indexOf(true), last = live.lastIndexOf(true);
    if (first < 0) { add('stale_filing', b, LAST, 'a', null, 'No print anywhere in the window.'); return; }
    if (last < LAST) {
      add('stale_filing', b, LAST, 'a', null,
        `Last filing ${P[last]}; ${LAST - last} quarter${LAST - last > 1 ? 's' : ''} missing at the reference date.`);
    }
    if (first > 0) {
      add('lagged_start', b, first, 'a', null,
        `Series starts ${P[first]} — ${first} leading quarter${first > 1 ? 's' : ''} of no data.`);
    }
    for (let i = first; i <= last; i++) {
      const miss = missFields.filter(k => b[k] && b[k][i] == null);
      if (miss.length) {
        add('missing_print', b, i, miss[0], null,
          miss.length + ' field' + (miss.length > 1 ? 's' : '') + ' with no print', miss);
      }
    }
  });

  /* 9 · duplicate segment table */
  if (D.modalities && D.mods) {
    const dup = D.mods.every((row, k) => {
      const m = D.modalities[k];
      return m && Math.abs(m.v - row.s[LAST]) < 1e-9;
    });
    if (dup) add('dup_modalities', null, null, 'modalities', null, 'All six rows equal the tail of the `mods` series.');
  }

  /* 10 · bridge notes that contradict their own numbers */
  (D.bridge || []).forEach(r => {
    if (!r.gaap) return;
    const g = (r.ifd - r.gaap) / r.gaap;
    if (Math.abs(g) > 0.0001 && /exact/i.test(r.note || '')) {
      add('bridge_note', null, null, 'bridge', g,
        `${r.bank} · ${r.line}: note says “${r.note}” but the gap is ${(g * 100).toFixed(2)}%.`);
    }
  });

  /* segments must exist before any query runs */
  buildSegments('cr', (b, i) => {
    const p = b.cr[i - 1], n = b.cr[i];
    if (p == null || p <= 0.5 || n == null) return false;
    return n === 0 || n / p < 0.8 || n / p > 1.25;
  });
  buildSegments('nim', (b, i) => {
    const p = b.nim[i - 1], n = b.nim[i];
    if (p == null || n == null) return false;
    const d = Math.abs(n - p), r = Math.abs(p) > 0.002 ? n / p : null;
    return d > 0.03 && (r == null || r > 2 || r < 0.5);
  });

  /* ---------- queries ---------- */
  function median(arr) {
    const s = arr.filter(v => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const issue = (bankId, field, i) => byKey.get(bankId + '|' + field + '|' + i) || null;

  /* a value the desk is allowed to print */
  function value(bank, field, i) {
    if (!bank || i == null) return null;
    const v = bank[field] ? bank[field][i] : null;
    if (v == null) return null;
    const f = issue(bank.id, field, i);
    if (f && f.cls === 'data' && (f.rule === 'cor_floor' || f.rule === 'credit_zero')) return null;
    if (field === 'cor' && bank.cr[i] === 0) return null;
    if (field === 'cov' && bank.cr[i] === 0) return null;
    return v;
  }

  /* a quarter-on-quarter change the desk is allowed to print */
  function delta(bank, field, i) {
    if (!bank || i == null || i < 1) return null;
    const a = value(bank, field, i), b0 = value(bank, field, i - 1);
    if (a == null || b0 == null) return null;
    const f = issue(bank.id, field, i);
    if (f && f.cls === 'data' && codes[f.rule]) return null;
    if ((field === 'cr' || field === 'cor' || field === 'cov') && crosses('cr', bank.id, i)) return null;
    if (field === 'nim' && crosses('nim', bank.id, i)) return null;
    if (field === 'ni' && b0 === 0) return null;
    return a - b0;
  }
  function growth(bank, field, i) {
    const d = delta(bank, field, i);
    if (d == null) return null;
    const b0 = value(bank, field, i - 1);
    return b0 ? d / b0 : null;
  }

  /* clean bank list for a cohort statistic: a bank is dropped when the field itself is invalid */
  function cohort(banks, field, i) {
    return (banks || B).filter(b => value(b, field, i) != null);
  }

  function grade(bankId) {
    const bank = bankId ? B.find(b => b.id === bankId) : null;
    if (!bank) return { grade: '—', errors: 0, gaps: 0, notes: 0, findings: [] };
    const fs = findings.filter(f => f.bankId === bank.id);
    const errors = fs.filter(f => f.cls === 'data' && f.sev === 'error').length;
    const gaps = fs.filter(f => f.cls === 'gap').length;
    const notes = fs.filter(f => f.cls === 'method' || f.cls === 'documentation' || f.cls === 'structural').length;
    const stale = fs.some(f => f.rule === 'stale_filing');
    const latestGap = fs.some(f => f.cls === 'gap' && f.i === LAST);
    let g = 'A';
    if (errors >= 8 || stale) g = 'D';
    else if (errors >= 3 || latestGap) g = 'C';
    else if (errors >= 1 || gaps > 0) g = 'B';
    return { grade: g, errors, gaps, notes, findings: fs, stale, label: labelFor(g, errors, gaps) };
  }
  function labelFor(g, errors, gaps) {
    if (g === 'A') return 'clean';
    if (g === 'D') return 'restate before use';
    return errors + ' restated' + (gaps ? ' · ' + gaps + ' gap' + (gaps > 1 ? 's' : '') : '');
  }

  /* coverage: present / usable counts per field per quarter */
  function coverage(field) {
    return P.map((q, i) => {
      const n = B.filter(b => b[field] && b[field][i] != null).length;
      const ok = B.filter(b => value(b, field, i) != null).length;
      return { q, i, n, ok, pct: n / B.length };
    });
  }
  const FIELDS = ['a', 'cr', 'eq', 'ni', 'dep', 'roe', 'roa', 'nim', 'cor', 'cov', 'eff'];
  const fieldDef = k => (RG.fields || []).find(f => f.key === k) || null;

  function summary() {
    const errors = findings.filter(f => f.cls === 'data' && f.sev === 'error');
    const gaps = findings.filter(f => f.cls === 'gap');
    const notes = findings.filter(f => f.cls === 'method' || f.cls === 'documentation' || f.cls === 'structural');
    const grades = { A: 0, B: 0, C: 0, D: 0 };
    B.forEach(b => { grades[grade(b.id).grade]++; });
    return {
      errors: errors.length, gaps: gaps.length, notes: notes.length,
      banksWithErrors: new Set(errors.map(f => f.bankId)).size,
      banksWithGaps: new Set(gaps.map(f => f.bankId)).size,
      grades, checks: checkCount(), rules: RG.rules.length,
      quarters: P.length, banks: B.length
    };
  }
  function checkCount() {
    return B.length * (P.length - 1) * 8      // per-bank, per-quarter step rules
      + B.length * 4                          // presence, leverage, tie-out, staleness
      + (D.bridge || []).length
      + (D.mods || []).length;
  }

  /* findings grouped for the register view */
  function grouped() {
    return RG.rules.map(r => {
      const fs = findings.filter(f => f.rule === r.id);
      const banks = [...new Set(fs.map(f => f.bank).filter(Boolean))];
      return { rule: r, findings: fs, count: fs.length, banks };
    });
  }

  function lineage(field, bankId, i) {
    const bank = bankId ? B.find(b => b.id === bankId) : null;
    const def = fieldDef(field);
    const f = bank && i != null ? issue(bank.id, field, i) : null;
    return {
      field, def, bank, i, q: i == null ? null : P[i],
      raw: bank && bank[field] ? bank[field][i] : null,
      shown: bank ? value(bank, field, i) : null,
      finding: f, segs: bank ? segment(field, bank.id) : null
    };
  }

  window.FaroQA = {
    findings, summary, grade, grouped, coverage, cohort, value, delta, growth,
    issue, segment, crosses, lineage, fieldDef, FIELDS, rules: RG.rules, register: RG,
    median
  };
})();
