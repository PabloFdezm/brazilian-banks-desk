/* FARO — shared data access, formatting and chrome.
   Load order: data.js → breaks.js → validate.js → app.js.
   Anything printed on the desk goes through FaroQA first. */
(function () {
  'use strict';

  const D = window.FARO;
  if (!D) { console.error('FARO dataset missing'); return; }
  const QA = window.FaroQA || null;
  const CAP = window.FARO_CAPITAL || null;
  const NPL = window.FARO_NPL || null;
  const P = D.periods, B = D.banks;
  const LAST = P.length - 1;
  const capOf = id => (CAP ? CAP.banks.find(b => b.id === id) : null) || null;
  const capVal = (id, k, i) => { const c = capOf(id); return c && c[k] && c[k][i] != null ? c[k][i] : null; };
  const nplOf = id => (NPL ? NPL.banks.find(b => b.id === id) : null) || null;
  const nplVal = (id, k, i) => { const n = nplOf(id); return n && n[k] && n[k][i] != null ? n[k][i] : null; };
  /* nothing is printed unless the harness can defend it */
  const val = (b, k, i) => QA ? QA.value(b, k, i) : (b && b[k] ? b[k][i] : null);
  const dlt = (b, k, i) => QA ? QA.delta(b, k, i) : (i > 0 && b[k][i] != null && b[k][i - 1] != null ? b[k][i] - b[k][i - 1] : null);

  const CATS = [
    { id: 'all', label: 'All', full: 'All conglomerates' },
    { id: 'Core', label: 'Core', full: 'Core' },
    { id: 'Federal & unlisted', label: 'Federal', full: 'Federal & unlisted' },
    { id: 'Listed regional', label: 'Regional', full: 'Listed regional' },
    { id: 'Payments & fintech', label: 'Fintech', full: 'Payments & fintech' }
  ];

  /* size encodings on the map — every one is a reported balance-sheet line */
  const SIZES = [
    { k: 'a', l: 'Assets', unit: 'R$ bn' },
    { k: 'cr', l: 'Loans', unit: 'R$ bn' },
    { k: 'dep', l: 'Deposits', unit: 'R$ bn' },
    { k: 'eq', l: 'Equity', unit: 'R$ bn' },
    { k: 'ni', l: 'Net income', unit: 'R$ bn' }
  ];

  /* colour encodings — sequential for levels, diverging for a change */
  const COLORS = [
    { k: 'roe', l: 'ROE', ramp: 'profit' },
    { k: 'roa', l: 'ROA', ramp: 'profit' },
    { k: 'nim', l: 'NIM', ramp: 'profit', note: 'margin' },
    { k: 'cor', l: 'Cost of risk', ramp: 'risk', low: true },
    { k: 'eff', l: 'Efficiency', ramp: 'risk', low: true },
    { k: 'droe', l: 'ROE Δ QoQ', ramp: 'div', delta: true }
  ];

  const LSKEY = 'faro.desk.v2';
  const state = { p: LAST, u: 'all', b: B[0].id, sz: 'a', cl: 'roe', vm: 'map', bsk: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(LSKEY) || '{}');
    if (Number.isInteger(raw.p) && raw.p >= 0 && raw.p <= LAST) state.p = raw.p;
    if (CATS.some(c => c.id === raw.u)) state.u = raw.u;
    if (B.some(b => b.id === raw.b)) state.b = raw.b;
    if (SIZES.some(s => s.k === raw.sz)) state.sz = raw.sz;
    if (COLORS.some(c => c.k === raw.cl)) state.cl = raw.cl;
    if (raw.vm === 'map' || raw.vm === 'ladder') state.vm = raw.vm;
    if (Array.isArray(raw.bsk)) state.bsk = raw.bsk.filter(id => B.some(b => b.id === id)).slice(0, 5);
  } catch (e) { /* private mode or file:// quota — defaults hold */ }

  function save() {
    try { localStorage.setItem(LSKEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------- formatting ---------- */
  const MINUS = '\u2212';
  const nf = (v, d) => v == null || Number.isNaN(v) ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const pct = (v, d) => v == null || Number.isNaN(v) ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%';
  const pctNum = (v, d) => v == null || Number.isNaN(v) ? '—' : (v * 100).toFixed(d == null ? 1 : d);
  const bn = v => v == null ? '—' : nf(v, v >= 1000 ? 0 : 1);
  const pp = (v, d) => v == null || Number.isNaN(v) ? '—'
    : (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v * 100).toFixed(d == null ? 1 : d);
  const dirClass = v => v == null || Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'down';

  const qLabel = q => q.slice(0, 4) + ' Q' + Math.ceil(Number(q.slice(4)) / 3);
  const qShort = q => "'" + q.slice(2, 4) + ' Q' + Math.ceil(Number(q.slice(4)) / 3);
  const qQtr = q => q.slice(0, 4) + ' Q' + Math.ceil(Number(q.slice(4)) / 3);

  /* ---------- statistics ---------- */
  const median = arr => {
    const s = arr.filter(v => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const minmax = arr => {
    const s = arr.filter(v => v != null && !Number.isNaN(v));
    return s.length ? { min: Math.min(...s), max: Math.max(...s) } : { min: null, max: null };
  };
  const pctl = (v, arr) => {
    const s = arr.filter(x => x != null && !Number.isNaN(x));
    if (v == null || s.length < 2) return null;
    let below = 0;
    for (const x of s) if (x < v) below++;
    const eq = s.filter(x => x === v).length;
    return (below + (eq - 1) / 2) / (s.length - 1) * 100;
  };

  const list = () => {
    let out = state.u === 'all' ? B : B.filter(b => b.cat === state.u);
    if (state.bsk.length >= 2) out = out.filter(b => state.bsk.indexOf(b.id) >= 0);
    return out;
  };
  const pinning = () => state.bsk.length >= 2;
  const byId = id => B.find(b => b.id === id);

  function agg(banks, i) {
    const mix = (k, w) => {
      let n = 0, d = 0;
      for (const b of banks) {
        const v = val(b, k, i), z = val(b, w, i);
        if (v != null && z != null && z > 0) { n += v * z; d += z; }
      }
      return d ? n / d : null;
    };
    let a = 0, cr = 0, dep = 0, eq = 0, ni = 0;
    for (const b of banks) {
      a += val(b, 'a', i) || 0; cr += val(b, 'cr', i) || 0;
      dep += val(b, 'dep', i) || 0; eq += val(b, 'eq', i) || 0; ni += val(b, 'ni', i) || 0;
    }
    return {
      n: banks.filter(b => val(b, 'a', i) != null).length,
      a, cr, dep, eq, ni,
      roe: mix('roe', 'eq'), nim: mix('nim', 'a'), cor: mix('cor', 'a'),
      cov: mix('cov', 'cr'), eff: mix('eff', 'a'),
      roa: mix('roa', 'a')
    };
  }

  const share = (b, i) => {
    const tot = B.reduce((s, x) => s + (val(x, 'a', i) || 0), 0);
    return tot ? (val(b, 'a', i) || 0) / tot : null;
  };
  const rankBy = (b, i, k, banks) => {
    const s = (banks || B).filter(x => val(x, k, i) != null).sort((x, y) => val(y, k, i) - val(x, k, i));
    return s.findIndex(x => x.id === b.id) + 1 || null;
  };

  /* ---------- income statement, derived ---------- */
  /* IF.Data gives ratios, not a full P&L. Three lines are derivable and one is a
     residual, so the bridge reconciles to reported net income by construction. */
  function pnl(b, i) {
    const a = val(b, 'a', i), cr = val(b, 'cr', i), nim = val(b, 'nim', i), cor = val(b, 'cor', i);
    const nii = nim != null && a != null ? nim * a : null;
    const prov = cor != null && cr != null && cr > 0 ? cor * cr : null;
    const pre = nii != null && prov != null ? nii - prov : null;
    const ni = val(b, 'ni', i);
    const other = pre != null && ni != null ? ni - pre : null;
    const r = v => v != null && a ? v / a : null;
    return { a, cr, nii, prov, pre, ni, other,
      rnii: r(nii), rprov: r(prov), rpre: r(pre), rni: r(ni), rother: r(other) };
  }
  function pnlSys(banks, i) {
    let nii = 0, prov = 0, ni = 0, a = 0, ok = false;
    (banks || B).forEach(b => {
      const v = pnl(b, i);
      if (v.nii != null && v.prov != null) { nii += v.nii; prov += v.prov; ok = true; }
      ni += val(b, 'ni', i) || 0; a += val(b, 'a', i) || 0;
    });
    if (!ok) return null;
    const pre = nii - prov, other = ni - pre, r = v => a ? v / a : null;
    return { a, nii, prov, pre, ni, other,
      rnii: r(nii), rprov: r(prov), rpre: r(pre), rni: r(ni), rother: r(other) };
  }

  /* ---------- the identity, line by line ----------
     ROE = leverage × [ margin − cost of risk × credit share + other ],
     anchored on the two ratios the banks report (ROE, ROA) so the chain closes
     exactly. "Other" is solved, never estimated. */
  function dupont(b, i) {
    const a = val(b, 'a', i), cr = val(b, 'cr', i);
    const nim = val(b, 'nim', i), cor = val(b, 'cor', i);
    const roa = val(b, 'roa', i), roe = val(b, 'roe', i);
    if (a == null || cr == null || nim == null || cor == null || roa == null || roe == null) return null;
    if (!(a > 0) || !(cr > 0) || !(roa > 0)) return null;
    const w = cr / a;                 // credit share of the balance sheet
    const e = cor * w;                // credit cost expressed on total assets
    const O = roa - nim + e;          // other result, solved to reported ROA
    const em = roe / roa;             // average-balance multiplier implied by the two ratios
    const eq = val(b, 'eq', i);
    return { w, e, O, em, roa, roe, nim, cor, a, cr,
      spot: eq && eq > 0 ? a / eq : null, niy: w > 0 ? nim / w : null };
  }

  /* change attribution, step = 1 (QoQ) or 4 (four quarters). Midpoint convention,
     so the five contributions sum to the reported change without a plug. */
  function dupontAttr(b, i, step) {
    const k = step || 1;
    if (i - k < 0) return { blocked: 'start' };
    const n = dupont(b, i), o = dupont(b, i - k);
    if (!n || !o) return { blocked: 'incomplete' };
    if (QA) {
      const split = [];
      for (let j = i - k + 1; j <= i; j++) {
        ['cr', 'a', 'nim', 'cor', 'roa', 'roe', 'ni'].forEach(f => {
          if (QA.crosses(f, b.id, j) && split.indexOf(P[j]) < 0) split.push(P[j]);
        });
      }
      if (split.length) return { blocked: 'split', split };
    }
    const avgEm = (n.em + o.em) / 2, avgRoA = (n.roa + o.roa) / 2;
    const avgW = (n.w + o.w) / 2, avgCor = (n.cor + o.cor) / 2;
    const cm = {
      lev: (n.em - o.em) * avgRoA,
      margin: avgEm * (n.nim - o.nim),
      cor: -avgEm * (n.cor - o.cor) * avgW,
      mix: -avgEm * avgCor * (n.w - o.w),
      other: avgEm * (n.O - o.O)
    };
    const total = cm.lev + cm.margin + cm.cor + cm.mix + cm.other;
    return { n, o, cm, total, delta: n.roe - o.roe, step: k };
  }
  const dupontFields = [['a', 'total assets'], ['cr', 'credit book'], ['nim', 'NIM'], ['cor', 'cost of risk'], ['roa', 'ROA'], ['roe', 'ROE']];
  function dupontMissing(b, i) {
    return dupontFields.filter(f => val(b, f[0], i) == null).map(f => f[1]);
  }

  /* ---------- colour scales ---------- */
  const RAMPS = {
    profit: [[0.948,0.016,266],[0.918,0.038,266],[0.836,0.070,266],[0.722,0.103,266],[0.596,0.128,266],[0.470,0.142,266],[0.352,0.116,266]],
    risk:   [[0.946,0.020,62],[0.902,0.050,58],[0.812,0.090,52],[0.702,0.124,44],[0.584,0.148,36],[0.468,0.138,30]]
  };
  const DIV = { lo: [0.535,0.158,27], mid: [0.970,0.006,266], hi: [0.480,0.100,176] };
  const INK = [0.205,0.010,270], WHITE = [0.995,0.002,270];

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = c => `oklch(${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(1)})`;
  function linear(c) {
    const h = c[2] * Math.PI / 180, A = c[1] * Math.cos(h), Bv = c[1] * Math.sin(h);
    const l = Math.pow(c[0] + 0.3963377774 * A + 0.2158037573 * Bv, 3);
    const m = Math.pow(c[0] - 0.1055613458 * A - 0.0638541728 * Bv, 3);
    const s = Math.pow(c[0] - 0.0894841775 * A - 1.2914855480 * Bv, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ].map(x => Math.max(0, Math.min(1, x)));
  }
  const lum = c => { const [r, g, b] = linear(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  /* step lightness until a label clears 5:1, then keep whichever ink wins */
  function legible(c) {
    const t = c.slice();
    for (let g = 0; g < 40; g++) {
      if (Math.max(contrast(t, INK), contrast(t, WHITE)) >= 5) break;
      t[0] += contrast(t, WHITE) > contrast(t, INK) ? -0.008 : 0.008;
      t[0] = Math.max(0.16, Math.min(0.99, t[0]));
    }
    return { c: t, ink: contrast(t, WHITE) > contrast(t, INK) ? WHITE : INK };
  }
  function quantile(arr, q) {
    const s = arr.filter(v => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!s.length) return null;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function valueOf(b, def, p) {
    if (def.delta) return QA ? QA.delta(b, 'roe', p) : (p > 0 && b.roe[p] != null && b.roe[p - 1] != null ? b.roe[p] - b.roe[p - 1] : null);
    return val(b, def.k, p);
  }
  /* one hue per side: red half keeps hue 27, teal half keeps 176, lightness does the work */
  function divColor(t) {
    if (t >= 0.5) {
      const k = (t - 0.5) * 2;
      return [DIV.mid[0] + (DIV.hi[0] - DIV.mid[0]) * k, DIV.mid[1] + (DIV.hi[1] - DIV.mid[1]) * k, DIV.hi[2]];
    }
    const k = t * 2;
    return [DIV.lo[0] + (DIV.mid[0] - DIV.lo[0]) * k, DIV.lo[1] + (DIV.mid[1] - DIV.lo[1]) * k, DIV.lo[2]];
  }
  function rampColor(stops, t) {
    const seg = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(seg));
    return mix(stops[k], stops[k + 1], seg - k);
  }

  function colorScale(def, banks, p) {
    const div = def.ramp === 'div';
    const vals = (banks || B).map(b => valueOf(b, def, p)).filter(v => v != null);
    let lo, hi;
    if (div) {
      const m = Math.max(0.01, quantile(vals.map(Math.abs), 0.92)) * 1.15;
      lo = -m; hi = m;
    } else {
      lo = quantile(vals, 0.10); hi = quantile(vals, 0.90);
      if (lo == null) { lo = 0; hi = 1; }
      if (hi - lo < 1e-6) { lo -= 0.01; hi += 0.01; }
    }
    const stops = RAMPS[def.ramp] || RAMPS.profit;
    const get = v => {
      if (v == null) return { fill: 'var(--surface-2)', ink: 'var(--muted)' };
      const raw = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      const t = div ? raw : Math.pow(raw, 0.85);
      const c = div ? divColor(t) : rampColor(stops, t);
      const l = legible(c);
      return { fill: css(l.c), ink: css(l.ink) };
    };
    const gradient = [0, 0.2, 0.4, 0.6, 0.8, 1]
      .map(r => css(div ? divColor(r) : rampColor(stops, Math.pow(r, 0.85)))).join(',');
    return { lo, hi, div, get, gradient };
  }

  /* ---------- svg helpers ----------
     fluid: fills its container (viewBox in user units, stroke kept at device
     width) so one spark can serve a fixed 62px cell and a full-width KPI.
     rule: a dashed line at the last print, so the series reads against "now". */
  function spark(vals, opts) {
    const o = opts || {};
    const w = o.w || 100, h = o.h || 26, pad = o.pad == null ? 2 : o.pad;
    const clean = vals.map(v => v == null ? null : v);
    let lo = Infinity, hi = -Infinity;
    clean.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (!isFinite(lo)) return '';
    if (hi === lo) { hi = lo + 1; lo -= 1; }
    const n = clean.length;
    const x = idx => pad + (n <= 1 ? 0 : idx / (n - 1)) * (w - pad * 2);
    const y = v => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    let d = '', pen = false;
    clean.forEach((v, idx) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(idx).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen = true;
    });
    const stroke = o.color || 'currentColor';
    const ve = o.fluid ? ' vector-effect="non-scaling-stroke"' : '';
    const area = o.fill ? `<path d="${d}L${x(n - 1).toFixed(1)} ${h - pad}L${x(0).toFixed(1)} ${h - pad}Z" fill="${o.fill}" stroke="none"/>` : '';
    const last = [...clean].reverse().find(v => v != null);
    const lastIdx = clean.lastIndexOf(last);
    const rule = o.rule && last != null
      ? `<path d="M${x(0).toFixed(1)} ${y(last).toFixed(1)}H${x(n - 1).toFixed(1)}" fill="none" stroke="${o.ruleColor || 'var(--border-strong)'}" stroke-width="1" stroke-dasharray="2 3" opacity=".55"${ve}/>`
      : '';
    const dot = (o.dot === false || (o.dot == null && o.fluid)) ? '' : `<circle cx="${x(lastIdx).toFixed(1)}" cy="${y(last).toFixed(1)}" r="1.7" fill="${stroke}"/>`;
    const dims = o.fluid ? `preserveAspectRatio="none" width="100%" height="${h}"` : `width="${w}" height="${h}"`;
    return `<svg viewBox="0 0 ${w} ${h}" ${dims} aria-hidden="true" focusable="false">${area}${rule}<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"${ve}/>${dot}</svg>`;
  }

  /* ---------- tooltip ---------- */
  let tipEl = null;
  function tip(html, x, y) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.id = 'tip';
      tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = html;
    tipEl.classList.add('on');
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > window.innerWidth - 10) left = x - r.width - 14;
    if (top < 8) top = y + 18;
    if (left < 8) left = 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  const untip = () => { if (tipEl) tipEl.classList.remove('on'); };

  /* ---------- state changes ---------- */
  const bus = new EventTarget();
  const emit = type => bus.dispatchEvent(new CustomEvent(type));
  function setPeriod(i) {
    i = Math.max(0, Math.min(LAST, i));
    if (i === state.p) return;
    state.p = i; save(); emit('period');
  }
  function setUniverse(u) {
    if (u === state.u) return;
    state.u = u; save(); emit('universe');
  }
  function setBank(id) {
    if (!byId(id)) return;
    state.b = id; save(); emit('bank');
  }
  function setMap(patch) {
    let changed = false;
    ['sz', 'cl', 'vm'].forEach(k => {
      if (patch[k] != null && patch[k] !== state[k]) { state[k] = patch[k]; changed = true; }
    });
    if (!changed) return;
    save(); emit('map');
  }
  const on = (type, fn) => bus.addEventListener(type, fn);
  const notify = () => { emit('period'); };

  /* ---------- chrome ---------- */
  const NAV = [
    { id: 'board', href: 'index.html', label: 'Sector board', i: '01', n: () => B.length },
    { id: 'pnl', href: 'pnl-lab.html', label: 'Income lab', i: '02', n: () => '13Q' },
    { id: 'capital', href: 'capital-lab.html', label: 'Capital lab', i: '03', n: () => CAP ? CAP.banks.length : '—' },
    { id: 'dossier', href: 'bank-dossier.html', label: 'Bank dossier', i: '04', n: () => '34' },
    { id: 'peers', href: 'peer-matrix.html', label: 'Peer matrix', i: '05', n: () => B.length },
    { id: 'credit', href: 'credit-risk.html', label: 'Credit & risk', i: '06', n: () => '8Q' },
    { id: 'bridge', href: 'ifrs-bridge.html', label: 'IFRS bridge', i: '07', n: () => (D.bridge || []).length },
    { id: 'audit', href: 'data-integrity.html', label: 'Data integrity', i: '08', n: () => QA ? QA.summary().errors : '—' }
  ];

  function metricDefs() {
    return [
      ['Reporting horizon', 'Every flow on this desk is a <b>twelve-month</b> figure ending at the reference quarter: net income, provisions and the margin ratios are trailing, not quarterly spot values. Moving one quarter shifts the whole window. That is why quarter-on-quarter changes look smooth.'],
      ['ROE', 'Net income (12M) ÷ average shareholders’ equity, as reported to IF.Data.'],
      ['ROA', 'Net income (12M) ÷ average total assets.'],
      ['NIM', 'Net interest margin: net interest income ÷ average total assets, as reported by the source. Where an institution defines NIM differently in its own release, we do not restate it.'],
      ['Cost of risk', 'Provision expense ÷ average credit portfolio, twelve months. The IF.Data coverage ratio sits in the next column.'],
      ['Coverage', 'Loan-loss provisions ÷ the credit portfolio. A crude proxy: it mixes stock provisions with gross loans. This is a provisions-to-book ratio, not a provisions-to-defaulted-book ratio.'],
      ['Cover of the defaulted book', 'Implied provisions (the reported coverage ratio × the credit book) ÷ the SCR defaulted stock from report 130. It reads as a multiple of the defaulted balance: below 1.0× the provision stock is smaller than the defaulted balance. The numerator and denominator come from two different filings with different scopes, so it is a provisioning-intensity indicator, not a filed coverage ratio. It needs a defaulted print, so it starts in 2025 Q1.'],
      ['Efficiency', 'Operating expenses ÷ operating income. Below 50% is strong; above 100% means costs exceed revenue.'],
      ['Income bridge', 'IF.Data does not publish a full income statement, so the Income lab derives three lines and reconciles to reported net income: net interest income = NIM × total assets; provision charge = cost of risk × credit book; then <b>other result</b> is the residual (fees, treasury and insurance income, operating costs and tax, net). It is stated as a residual, never split.'],
      ['Aggregates', 'System ROE is equity-weighted; NIM, cost of risk and efficiency are asset-weighted; coverage is credit-weighted. These are weighted averages of reported ratios, not re-aggregated income statements. A bank whose print the harness suppressed is excluded from the weight instead of being counted at zero.'],
      ['Validation', 'Every value on the desk passes a harness of fourteen rules before it is printed: definitions, signs, magnitudes, ties and gaps. A print that fails is null, never a plausible-looking number. The full register — rule, evidence, affected banks, restatement decision — lives on <b>Data integrity</b>, and any figure can be clicked for its lineage.'],
      ['Basel ratio', 'Patrimônio de Referência (PR) ÷ Ativos Ponderados pelo Risco (RWA), as reported to IF.Data report 5. PR is total loss-absorbing capital: Capital Principal (CET1) + Capital Complementar (AT1) + Nível II. The desk does not recompute the ratio; it prints the reported print and checks it against PR ÷ RWA.'],
      ['CET1 ratio', 'Capital Principal ÷ RWA, as reported. The gap between Basel and CET1 is AT1 plus Tier II capital — the part that absorbs loss only after CET1 is gone.'],
      ['RWA and density', 'RWA is the Basel risk-weighted asset base. Density is RWA ÷ total assets: below 50% means a book heavy in mortgages, sovereign or low-weight wholesale; above 70% means retail, SME or high-risk-weight exposure. Density is not a quality score — it is a map of what the balance sheet is made of.'],
      ['ROE decomposition (DuPont)', 'Net interest margin plus other result, less the credit charge. Every figure is either filed or an exact consequence of a filed one: <b>credit share</b> = credit book ÷ total assets; <b>credit cost</b> = cost of risk × credit share; <b>other result</b> = reported ROA − margin + credit cost, solved so the bracket equals reported ROA exactly; <b>leverage</b> = ROE ÷ ROA, the average-balance multiplier the two reported ratios imply. So ROE = leverage × (margin − cost of risk × credit share + other) holds to the last basis point instead of being a rearrangement that leaves a plug. Change is attributed with the midpoint convention (ΔA × avg B + avg A × ΔB), which makes the five contributions sum to the reported change. Two limits: the multiplier is an average-balance figure, not spot assets ÷ equity, and the solved residual differs from the Income lab&rsquo;s spot-balance residual by the average-versus-spot basis.'],
      ['RAROC', '12M net income ÷ average PR over the five quarter-ends in the window. Net income is already after the provision charge, so expected loss is inside the numerator; capital is risk-weighted, so risk is inside the denominator. It is a return on regulatory risk capital, not a full economic-capital RAROC. We do not add provisions back: that would mix a pre-tax charge with an after-tax profit.'],
      ['Capital floor', '10.5% is drawn as a reference line only: the 8% minimum plus the 2.5% conservation buffer. It excludes systemic surcharges (up to 2.5pp for S1/S2 banks) and any bank-specific add-on, so headroom shown above that line is an upper bound, not a buffer the bank is free to distribute.'],
      ['Capital source', 'IF.Data report 5, prudential conglomerate scope. PR is filed from 2024 Q4 onward; before that it is derived as the reported Basel ratio × RWA and the basis is carried per point. RAROC therefore starts once five quarters of capital exist — 2024 Q3 at the latest, 2023 Q4 for banks that reported earlier.'],
      ['Defaulted book (NPL90)', 'Carteira ativa inadimplida arrastada ÷ total da carteira ativa de crédito, per institution, as filed to IF.Data report 130 (SCR, document 3040). It is the defaulted balance that remains on book — not the provision charge — with the Res. BCB 4.966 concept of a defaulted instrument (a payment more than 90 days overdue) behind the source column. <b>Published from 2025 Q1 only</b>: before that IF.Data prints a regulatory risk grading (AA..H), which is a different measure, so earlier quarters stay blank instead of being approximated. A zero defaulted balance on a real book is treated as a filing gap, not as zero risk.'],
      ['Map encoding', 'Area is the selected size line (assets, loans, deposits, equity or net income). Fill is the selected ratio, using a sequential ramp between the 5th and 95th percentile of the cohort, or a diverging ramp for a change. Lightness is stepped so every tile label clears 5:1 contrast.'],
      ['Universe', '34 conglomerates reporting to IF.Data. “Types” follow our own grouping: Core (large listed and unlisted banks), Federal & unlisted (Caixa, BNDES, BRB), Listed regional (Banestes, Banrisul-type state banks), Payments & fintech.']
    ];
  }

  function mountChrome() {
    const page = document.body.dataset.page || 'board';
    const rail = document.getElementById('rail');
    if (rail) {
      rail.innerHTML = `
        <div class="brand">
          <div class="brand__mark"><span></span></div>
          <div>
            <div class="brand__name">FARO</div>
            <div class="brand__sub">Brazilian banks<br>IF.Data · 2023–26</div>
          </div>
        </div>
        <div class="rail__label">Desk</div>
        <nav class="nav" aria-label="Desk sections">
          ${NAV.map(n => `<a class="navlink" href="${n.href}" ${n.id === page ? 'aria-current="page"' : ''}>
            <span class="navlink__i">${n.i}</span><span class="navlink__t">${n.label}</span><span class="navlink__n">${n.n()}</span>
          </a>`).join('')}
        </nav>
        <div class="rail__basket" id="railBasket"></div>
        <div class="rail__foot">
          <p><strong>Source</strong> BCB IF.Data<br>Res. 4.966 · IFRS bridge<br>Snapshot ${qLabel(P[LAST])} · ${QA ? QA.summary().errors : 0} restated prints</p>
        </div>`;
      renderBasket();
    }

    const top = document.getElementById('topbar');
    if (top) {
      const q = qLabel(P[state.p]);
      top.innerHTML = `
        <div class="topbar__id">
          <div class="topbar__k">${document.body.dataset.kicker || 'IF.Data'}</div>
          <div class="topbar__t">${document.body.dataset.title || 'Sector board'}</div>
        </div>
        <div class="topbar__right">
          <div class="period" role="group" aria-label="Reporting period">
            <button class="period__b" id="pPrev" aria-label="Previous quarter">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>
            </button>
            <div class="period__v"><b id="pLabel">${q}</b></div>
            <button class="period__b" id="pNext" aria-label="Next quarter">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>
            </button>
          </div>
          <div class="chips" id="uniChips" role="group" aria-label="Universe">
            ${CATS.map(c => `<button class="chip" data-u="${c.id}" aria-pressed="${state.u === c.id}" title="${c.full}">${c.label}</button>`).join('')}
          </div>
          <button class="btn btn--sm basketBtn" id="basketBtn" title="Comparison basket" aria-label="Comparison basket">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4.5h10M4.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M3.2 4.5l.7 7a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.7-7"/></svg>
            <span id="basketN">Basket</span>
          </button>
          <button class="btn btn--sm" id="defsBtn">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="5.4"/><path d="M5.6 5.4a1.5 1.5 0 1 1 2 1.4c-.5.2-.6.5-.6 1"/><path d="M7 9.6v.1"/></svg>
            Definitions
          </button>
        </div>`;

      const sync = () => {
        document.getElementById('pLabel').textContent = qLabel(P[state.p]);
        document.getElementById('pPrev').disabled = state.p === 0;
        document.getElementById('pNext').disabled = state.p === LAST;
        document.querySelectorAll('#uniChips .chip').forEach(c => {
          c.setAttribute('aria-pressed', String(c.dataset.u === state.u));
        });
      };
      document.getElementById('pPrev').onclick = () => setPeriod(state.p - 1);
      document.getElementById('pNext').onclick = () => setPeriod(state.p + 1);
      document.querySelectorAll('#uniChips .chip').forEach(c => { c.onclick = () => setUniverse(c.dataset.u); });
      document.getElementById('defsBtn').onclick = () => openDefs();
      const bb = document.getElementById('basketBtn');
      if (bb) bb.onclick = () => openBasket();
      const bnEl = document.getElementById('basketN');
      const syncB = () => { if (bnEl) bnEl.textContent = pinning() ? 'Basket · ' + state.bsk.length : 'Basket'; };
      syncB(); on('basket', syncB);
      on('period', sync); on('universe', sync);
      sync();
    }

    document.addEventListener('keydown', e => {
      const t = e.target;
      if (t && t.closest && t.closest('input, select, textarea, dialog')) return;
      if (e.key === 'ArrowLeft') { setPeriod(state.p - 1); }
      if (e.key === 'ArrowRight') { setPeriod(state.p + 1); }
    });
  }

  let defsDialog = null;
  function openDefs() {
    if (!defsDialog) {
      defsDialog = document.createElement('dialog');
      defsDialog.className = 'defs';
      defsDialog.innerHTML = `
        <div class="defs__h">
          <div>
            <h2>How these numbers are built</h2>
            <p>Every figure traces to BCB IF.Data; the bridge section also uses bank-reported IFRS.</p>
          </div>
          <button class="x" aria-label="Close">✕</button>
        </div>
        <div class="defs__b">
          <dl class="mgrid">
            ${metricDefs().map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
          </dl>
          <div class="note">
            <div class="note__k">Restated</div>
            <p><strong>Three structural breaks are corrected, not hidden.</strong> The credit book changes definition at 2025 Q1, margins reset at 2025 Q4 for the payments cohort, and some provision charges arrive with the wrong sign. Series are split at those joins; growth across a join is blank; impossible prints are suppressed. The register lists each one with its evidence.</p>
          </div>
          <div class="note">
            <div class="note__k">Not covered</div>
            <p><strong>Market prices and funding costs are not in this extract.</strong> Capital, RWA and the bank-level defaulted book are joined from IF.Data reports 5 and 130, so the returns are leverage-adjusted and asset quality is now per institution. The defaulted series starts in 2025 Q1 because the source only publishes it from then; each screen states its own coverage.</p>
          </div>
          <div class="note">
            <div class="note__k">Bridge</div>
            <p>26 line items compare IF.Data against bank-reported IFRS. Differences are <strong>not errors</strong>: individual vs consolidated statements, insurance entities carried at equity, and different credit definitions all move the same line.</p>
          </div>
          <p class="footnote">Snapshot ${qLabel(P[0])} → ${qLabel(P[LAST])} · 34 conglomerates · ${P.length} quarters. Rate-type ratios are reported values; we do not annualise or restate them.</p>
        </div>
        <div class="defs__f"><button class="btn" data-close>Close</button></div>`;
      document.body.appendChild(defsDialog);
      const close = () => defsDialog.close();
      defsDialog.querySelector('.x').onclick = close;
      defsDialog.querySelector('[data-close]').onclick = close;
      defsDialog.addEventListener('click', e => { if (e.target === defsDialog) close(); });
    }
    defsDialog.showModal();
  }

  /* ---------- csv ---------- */
  function csv(rows, filename) {
    const body = rows.map(r => r.map(c => {
      const s = c == null ? '' : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- data quality ---------- */
  const gradeOf = id => QA ? QA.grade(id) : { grade: '—', errors: 0, gaps: 0, notes: 0, label: 'harness off' };
  const brief = n => String(n).replace(/^Banco /, '').replace(/^Banco do /, '').replace(/ S\.A\.$/, '');
  function qaBadge(id, opts) {
    const g = gradeOf(id);
    const o = opts || {};
    const title = `Data quality ${g.grade} · ${g.errors} restated print${g.errors === 1 ? '' : 's'}, ${g.gaps} gap${g.gaps === 1 ? '' : 's'}, ${g.notes} note${g.notes === 1 ? '' : 's'}`;
    return `<a class="qab" data-g="${g.grade}" href="data-integrity.html?b=${encodeURIComponent(id)}" title="${esc(title)}">${o.long ? 'Quality ' : ''}${g.grade}${o.count ? `<b>${g.errors}</b>` : ''}</a>`;
  }

  /* ---------- basket ---------- */
  function renderBasket() {
    const host = document.getElementById('railBasket');
    if (!host) return;
    const ids = state.bsk, on = pinning();
    host.innerHTML = `
      <div class="rail__label">Basket</div>
      <div class="bk">
        ${ids.length ? `<div class="bk__chips">${ids.map(id => {
          const b = byId(id);
          return b ? `<button class="bk__chip" data-drop="${b.id}" title="Unpin ${esc(b.name)}">${esc(brief(b.name))}<span>✕</span></button>` : '';
        }).join('')}</div>` : '<p class="bk__none">No pins — the universe is every reporting bank.</p>'}
        <div class="bk__act">
          <button class="btn btn--sm" id="bkEdit">${ids.length ? 'Edit pins' : 'Pin banks'}</button>
          ${on ? '<button class="btn btn--sm" id="bkClear">Clear</button>' : ''}
        </div>
        ${on ? `<p class="bk__state">${ids.length} pinned · every screen filtered</p>` : ''}
      </div>`;
    const e = document.getElementById('bkEdit');
    if (e) e.onclick = openBasket;
    const c = document.getElementById('bkClear');
    if (c) c.onclick = () => setBasket([]);
    host.querySelectorAll('[data-drop]').forEach(el => {
      el.onclick = () => setBasket(state.bsk.filter(x => x !== el.dataset.drop));
    });
  }
  function setBasket(ids) {
    state.bsk = Array.from(new Set(ids)).filter(id => byId(id)).slice(0, 5);
    save(); renderBasket(); emit('basket');
  }
  let basketDialog = null;
  function openBasket() {
    if (!basketDialog) {
      basketDialog = document.createElement('dialog');
      basketDialog.className = 'defs basket';
      document.body.appendChild(basketDialog);
      basketDialog.addEventListener('click', e => { if (e.target === basketDialog) basketDialog.close(); });
    }
    const sorted = B.slice().sort((a, b) => (b.a[LAST] || 0) - (a.a[LAST] || 0));
    basketDialog.innerHTML = `
      <div class="defs__h">
        <div>
          <h2>Comparison basket</h2>
          <p>Pin two to five banks. Every screen — map, dossier, peers, credit, income — reads the basket instead of the universe until you clear it.</p>
        </div>
        <button class="x" aria-label="Close">✕</button>
      </div>
      <div class="defs__b">
        <div class="bkpick">
          ${sorted.map(b => `<label class="bkpick__r">
            <input type="checkbox" value="${b.id}" ${state.bsk.indexOf(b.id) >= 0 ? 'checked' : ''}>
            <span class="bkpick__n">${esc(b.name)}</span>
            <span class="bkpick__c">${esc(b.cat)}</span>
            <span class="bkpick__q">${gradeOf(b.id).grade}</span>
          </label>`).join('')}
        </div>
        <p class="footnote" id="bkCount"></p>
      </div>
      <div class="defs__f">
        <button class="btn" data-clear>Clear</button>
        <button class="btn btn--primary" data-apply>Apply basket</button>
      </div>`;
    const boxes = [...basketDialog.querySelectorAll('input')];
    const count = basketDialog.querySelector('#bkCount');
    const sync = () => {
      const n = boxes.filter(b => b.checked).length;
      count.textContent = n + ' of 5 pinned' + (n === 1 ? ' — one pin does nothing; pin at least two' : '');
    };
    boxes.forEach(bx => { bx.onchange = () => {
      if (boxes.filter(b => b.checked).length > 5) { bx.checked = false; }
      sync();
    }; });
    sync();
    basketDialog.querySelector('.x').onclick = () => basketDialog.close();
    basketDialog.querySelector('[data-clear]').onclick = () => { setBasket([]); basketDialog.close(); };
    basketDialog.querySelector('[data-apply]').onclick = () => {
      setBasket(boxes.filter(b => b.checked).map(b => b.value));
      basketDialog.close();
    };
    basketDialog.showModal();
  }

  /* ---------- lineage ---------- */
  let linDialog = null;
  function openLineage(field, bankId, i) {
    if (!QA) return;
    const L = QA.lineage(field, bankId, i);
    const def = L.def || {};
    if (!linDialog) {
      linDialog = document.createElement('dialog');
      linDialog.className = 'defs lin';
      document.body.appendChild(linDialog);
      linDialog.addEventListener('click', e => { if (e.target === linDialog) linDialog.close(); });
    }
    const f = L.finding;
    const pctish = def.kind === 'ratio';
    const fmtV = v => v == null ? '—' : pctish ? pct(v, 2) : bn(v) + ' bn';
    const segs = (L.segs || []).map(s => P[s]);
    linDialog.innerHTML = `
      <div class="defs__h">
        <div>
          <h2>${esc(def.label || field)}</h2>
          <p>${esc(L.bank ? L.bank.name : 'System')} · ${L.q ? qLabel(L.q) : 'all quarters'} · IF.Data</p>
        </div>
        <button class="x" aria-label="Close">✕</button>
      </div>
      <div class="defs__b">
        <div class="lin__figs">
          <div><span class="lin__k">Shown</span><span class="lin__v">${fmtV(L.shown)}</span></div>
          <div><span class="lin__k">Source print</span><span class="lin__v">${fmtV(L.raw)}</span></div>
          <div><span class="lin__k">Status</span><span class="lin__v">${L.raw == null ? 'no filing' : L.shown == null ? 'suppressed' : 'reported'}</span></div>
        </div>
        <dl class="mgrid">
          <div><dt>Numerator</dt><dd>${esc(def.numerator || '—')}</dd></div>
          <div><dt>Denominator</dt><dd>${esc(def.denominator || '—')}</dd></div>
          <div><dt>Horizon</dt><dd>${esc(def.annualisation || 'point in time')}</dd></div>
          <div><dt>Basis</dt><dd>${esc(def.basis || '—')}</dd></div>
          <div><dt>Source</dt><dd>${esc(def.source || '—')}</dd></div>
          <div><dt>Snapshot</dt><dd>as of ${RG()} · retrieved ${(QA.register.snapshot || {}).retrieved || '—'}</dd></div>
        </dl>
        ${f ? `<div class="note"><div class="note__k">${esc(f.sev)}</div><p><strong>${esc(f.title)}</strong><br>${esc(f.msg)} Decision: ${esc(f.decision)}</p></div>`
          : `<div class="note"><div class="note__k">Clear</div><p>No harness finding on this print. The value passes every rule that applies to it.</p></div>`}
        ${segs.length > 1 ? `<p class="footnote">Series is split at ${segs.slice(1).map(qLabel).join(', ')} — growth and change are not computed across those joins.</p>` : ''}
      </div>
      <div class="defs__f">
        <a class="btn" href="data-integrity.html${L.bank ? '?b=' + encodeURIComponent(L.bank.id) : ''}">Open the register</a>
        <button class="btn btn--primary" data-close>Close</button>
      </div>`;
    linDialog.querySelector('.x').onclick = () => linDialog.close();
    linDialog.querySelector('[data-close]').onclick = () => linDialog.close();
    linDialog.showModal();
  }
  const RG = () => (QA && QA.register && QA.register.snapshot ? qLabel((QA.register.snapshot.reference || '').replace('-', '')) : '—');

  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-lin]');
    if (!el) return;
    e.preventDefault();
    const [field, id, q] = el.dataset.lin.split(':');
    const i = q ? P.indexOf(q) : state.p;
    openLineage(field, id === 'sys' ? null : id, i < 0 ? state.p : i);
  });

  /* ---------- analyst notes ---------- */
  const NKEY = 'faro.notes.v1';
  function notesAll() {
    try { return JSON.parse(localStorage.getItem(NKEY) || '{}'); } catch (e) { return {}; }
  }
  function noteGet(bankId, i) {
    const n = notesAll();
    return (n[bankId] && n[bankId][P[i]]) || '';
  }
  function noteSet(bankId, i, text) {
    const n = notesAll();
    n[bankId] = n[bankId] || {};
    if (text && text.trim()) n[bankId][P[i]] = text.trim(); else delete n[bankId][P[i]];
    try { localStorage.setItem(NKEY, JSON.stringify(n)); } catch (e) {}
    return n[bankId][P[i]] || '';
  }
  function notesOf(bankId) {
    const n = notesAll()[bankId] || {};
    return Object.keys(n).sort().map(q => ({ q, text: n[q] }));
  }

  /* ---------- exports ---------- */
  const FIELDS = QA ? QA.FIELDS : ['a', 'cr', 'eq', 'ni', 'dep', 'roe', 'roa', 'nim', 'cor', 'cov', 'eff'];
  function exportTidy(banks) {
    const rows = [['bank_id', 'bank', 'period', 'field', 'value', 'status', 'flag', 'source', 'retrieved']];
    const asof = (QA && QA.register.snapshot) ? QA.register.snapshot.retrieved : '';
    (banks || list()).forEach(b => {
      P.forEach((q, i) => {
        FIELDS.forEach(k => {
          const raw = b[k] ? b[k][i] : null;
          const shown = QA ? QA.value(b, k, i) : raw;
          const f = QA ? QA.issue(b.id, k, i) : null;
          const status = raw == null ? 'missing' : shown == null ? 'suppressed' : 'reported';
          rows.push([b.id, b.name, q, k, shown == null ? '' : shown, status, f ? f.rule : '', 'IF.Data', asof]);
        });
      });
    });
    csv(rows, 'faro-tidy-' + P[state.p] + '.csv');
  }
  function exportFindings() {
    const rows = [['rule', 'class', 'severity', 'bank', 'quarter', 'field', 'value', 'message', 'decision']];
    (QA ? QA.findings : []).forEach(f => rows.push([f.rule, f.cls, f.sev, f.bank, f.q || '', f.field || '', f.value == null ? '' : f.value, f.msg, f.decision]));
    csv(rows, 'faro-defect-register.csv');
  }

  window.Faro = {
    D, P, B, CATS, SIZES, COLORS, LAST, state, QA, val, dlt,
    list, pinning, byId, agg, share, rankBy, median, minmax, pctl, quantile,
    pnl, pnlSys, dupont, dupontAttr, dupontMissing, valueOf, colorScale, css, legible,
    fmt: { nf, pct, pctNum, bn, pp, dirClass, qLabel, qShort, qQtr, esc, MINUS },
    spark, tip, untip, gradeOf, qaBadge, brief,
    setPeriod, setUniverse, setBank, setMap, setBasket, on, notify, save, renderBasket,
    openBasket, openLineage, noteGet, noteSet, notesOf,
    exportTidy, exportFindings,
    CAP, capOf, capVal,
    NPL, nplOf, nplVal,
    csv, openDefs, mountChrome
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountChrome);
  } else {
    mountChrome();
  }
})();
