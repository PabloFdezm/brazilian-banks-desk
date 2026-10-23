/* Build assets/capital.js from BCB IF.Data "Informações de Capital" (report 5).

   Source: https://www3.bcb.gov.br/ifdata/rest/arquivos
     - pre-2025:  ifdata//YYYYMM/dadosYYYYMM_5.json
                  ifdata//YYYYMM/cadastroYYYYMM_1009.json
     - 2025+:     ifdata_2025_2030//YYYYMM/...
   The same numbers are behind the OLinda IfDataValores endpoint, which was
   returning HTTP 500 for every period while this was built; the REST archive
   is the portal's own download path and carries the identical account codes.

   Run: node tools/build-capital.js [--refresh]

   Outputs:
     assets/capital.js             window.FARO_CAPITAL (file:// friendly)
     assets/capital-provenance.json  per-file URL, sha256, bytes, retrieved

   Nothing is invented: a missing print stays null. PR is reported from 202412
   onward; before that it is derived as Basel ratio x RWA and the basis is
   recorded per point. RAROC is defined in the header of the emitted file.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'ifdata-capital');
const OUT_JS = path.join(ROOT, 'assets', 'capital.js');
const OUT_JSON = path.join(ROOT, 'assets', 'capital-provenance.json');
const REFRESH = process.argv.includes('--refresh');
const RETRIEVED = new Date().toISOString();

const ACCOUNTS = {
  basel: '79664',   // Índice de Basileia
  cet1: '79659',    // Índice de Capital Principal
  tier1: '79660',   // Índice de Capital Nível I
  lev: '79661',     // Razão de Alavancagem
  rwa: '79665',     // Ativos Ponderados pelo Risco
  rwaCr: '138232',  // RWA risco de crédito (79650 in older prints)
  rwaMkt: '79651',  // RWA risco de mercado
  rwaOp: '79656',   // RWA risco operacional
  pr: '79649',      // Patrimônio de Referência
  cet1Amt: '79645'  // Capital Principal (amount)
};

/* ---------- read the desk snapshot ---------- */
const dataSrc = fs.readFileSync(path.join(ROOT, 'assets', 'data.js'), 'utf8');
const jsonText = dataSrc.slice(dataSrc.indexOf('{'), dataSrc.lastIndexOf('}') + 1);
const FARO = JSON.parse(jsonText);
const P = FARO.periods.slice();
const BANKS = FARO.banks;
const BANK_IDS = new Set(BANKS.map(b => b.id));

/* Four warm-up quarters so RAROC at the first displayed print averages a
   full twelve-month capital base (5 quarter-ends). */
const before = q => {
  let y = Number(q.slice(0, 4)), m = Number(q.slice(4));
  m -= 3; if (m <= 0) { m += 12; y -= 1; }
  return String(y) + String(m).padStart(2, '0');
};
const WARM = [];
{
  let q = P[0];
  for (let i = 0; i < 4; i++) { q = before(q); WARM.unshift(q); }
}
const ALL = WARM.concat(P);

/* ---------- fetch with cache ---------- */
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function urlFor(q, name) {
  const base = Number(q) >= 202503 ? 'ifdata_2025_2030//' : 'ifdata//';
  return 'https://www3.bcb.gov.br/ifdata/rest/arquivos?nomeArquivo='
    + encodeURIComponent(base + q + '/' + name);
}

async function get(q, name) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && !REFRESH) {
    return { buf: fs.readFileSync(file), cached: true, url: urlFor(q, name) };
  }
  const url = urlFor(q, name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FARO-capital/1.0' } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length > 500 && (buf[0] === 0x5b || buf[0] === 0x7b)) {
      fs.writeFileSync(file, buf);
      await sleep(250);
      return { buf, cached: false, url };
    }
    await sleep(1200 * (attempt + 1));
  }
  if (fs.existsSync(file)) {
    return { buf: fs.readFileSync(file), cached: true, url, stale: true };
  }
  return { buf: null, url };
}

/* cadastro: id (C0080099) -> entity code in the capital file */
const idFromCadastro = r => {
  const c33 = String(r.c33 || '');
  if (c33.length === 8) return 'C0' + c33.slice(2);
  // cadastro files before 2024-12 carry no c33; c0 ends with the same 6-digit code
  const c0 = String(r.c0 || '');
  return c0.length >= 6 ? 'C0' + c0.slice(-6) : null;
};

function parseCadastro(buf) {
  const rows = JSON.parse(buf.toString('utf8'));
  const map = new Map();               // bank id -> entity number
  rows.forEach(r => {
    const id = idFromCadastro(r);
    if (!id || !BANK_IDS.has(id)) return;
    // the capital payload keys entities by c0 read as an integer (leading zeros dropped)
    const e = Number(String(r.c0).replace(/^0+/, ''));
    if (!Number.isFinite(e)) return;
    map.set(id, e);
  });
  return { map, rows: rows.length };
}

function parseCapital(buf) {
  const d = JSON.parse(buf.toString('utf8'));
  const byE = new Map();
  d.values.forEach(x => {
    const acc = {};
    x.v.forEach(v => { acc[String(v.i)] = v.v; });
    byE.set(Number(x.e), acc);
  });
  return { byE, rows: d.values.length };
}

(async () => {
  const cadByPeriod = new Map();
  const capByPeriod = new Map();
  const files = {};
  const missingFiles = [];

  for (const q of ALL) {
    const cName = 'cadastro' + q + '_1009.json';
    const dName = 'dados' + q + '_5.json';
    const cRes = await get(q, cName);
    const dRes = await get(q, dName);

    if (cRes.buf) {
      files[cName] = {
        url: cRes.url, bytes: cRes.buf.length, sha256: sha(cRes.buf),
        cached: !!cRes.cached, stale: !!cRes.stale, retrieved: RETRIEVED
      };
      cadByPeriod.set(q, parseCadastro(cRes.buf));
    } else missingFiles.push(cName);

    if (dRes.buf) {
      files[dName] = {
        url: dRes.url, bytes: dRes.buf.length, sha256: sha(dRes.buf),
        cached: !!dRes.cached, stale: !!dRes.stale, retrieved: RETRIEVED
      };
      capByPeriod.set(q, parseCapital(dRes.buf));
    } else missingFiles.push(dName);
  }

  /* 202306 predates the prudential-conglomerate cadastro file; entity codes are
     stable, so borrow the nearest one and say so. */
  const cadFor = q => {
    if (cadByPeriod.has(q)) return { map: cadByPeriod.get(q).map, from: q };
    const keys = [...cadByPeriod.keys()].sort();
    for (const k of keys) {
      if (k >= q) return { map: cadByPeriod.get(k).map, from: k };
    }
    const last = keys[keys.length - 1];
    return { map: cadByPeriod.get(last).map, from: last };
  };

  const val = (acc, code) => {
    const v = acc[code];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const banks = [];
  const findings = [];
  const coverage = [];

  BANKS.forEach(b => {
    const all = {
      basel: [], cet1: [], tier1: [], lev: [], rwa: [], rwaCr: [], rwaMkt: [], rwaOp: [], pr: [], prBasis: []
    };
    const prByQ = new Map();

    ALL.forEach(q => {
      const cap = capByPeriod.get(q);
      const cad = cadFor(q);
      const e = cad.map.get(b.id);
      const acc = cap && e != null ? cap.byE.get(e) : null;
      if (!acc) {
        Object.keys(all).forEach(k => all[k].push(null));
        return;
      }
      const basel = val(acc, ACCOUNTS.basel);
      const rwa = val(acc, ACCOUNTS.rwa);
      const reportedPr = val(acc, ACCOUNTS.pr);
      const derivedPr = basel != null && rwa != null ? basel * rwa : null;
      const pr = reportedPr != null ? reportedPr : derivedPr;
      all.basel.push(basel);
      all.cet1.push(val(acc, ACCOUNTS.cet1));
      all.tier1.push(val(acc, ACCOUNTS.tier1));
      all.lev.push(val(acc, ACCOUNTS.lev));
      all.rwa.push(rwa == null ? null : rwa / 1e9);
      const rc = val(acc, ACCOUNTS.rwaCr) != null ? val(acc, ACCOUNTS.rwaCr) : val(acc, '79650');
      all.rwaCr.push(rc == null ? null : rc / 1e9);
      all.rwaMkt.push(val(acc, ACCOUNTS.rwaMkt) == null ? null : val(acc, ACCOUNTS.rwaMkt) / 1e9);
      all.rwaOp.push(val(acc, ACCOUNTS.rwaOp) == null ? null : val(acc, ACCOUNTS.rwaOp) / 1e9);
      all.pr.push(pr == null ? null : pr / 1e9);
      all.prBasis.push(reportedPr != null ? 'reported' : derivedPr != null ? 'derived' : null);
      prByQ.set(q, pr == null ? null : pr / 1e9);
    });

    const row = { id: b.id, name: b.name };
    Object.keys(all).forEach(k => { row[k] = all[k].slice(WARM.length); });
    row.density = P.map((q, i) => row.rwa[i] != null && b.a[i] ? row.rwa[i] / b.a[i] : null);
    row.raroc = P.map((q, i) => {
      const prs = [];
      let w = q;
      for (let k = 0; k < 5; k++) {
        const v = prByQ.get(w);
        if (v != null) prs.push(v);
        if (k < 4) w = before(w);
      }
      return prs.length === 5 && b.ni[i] != null
        ? b.ni[i] / (prs.reduce((s, v) => s + v, 0) / 5)
        : null;
    });
    banks.push(row);
  });

  /* ---------- checks ---------- */
  let maxRatioErr = 0, ratioN = 0, orderFail = [], missing = [], breaks = [];
  const perPeriod = {};
  P.forEach((q, i) => {
    const here = banks.filter(b => b.basel[i] != null);
    perPeriod[q] = { banks: here.length, raroc: banks.filter(b => b.raroc[i] != null).length };
    banks.forEach(b => {
      if (b.basel[i] == null) { missing.push(b.id + '@' + q); return; }
      if (b.pr[i] != null && b.rwa[i]) {
        const calc = b.pr[i] / b.rwa[i];
        const err = Math.abs(calc - b.basel[i]);
        if (err > maxRatioErr) maxRatioErr = err;
        ratioN++;
      }
      if (b.cet1[i] != null && b.tier1[i] != null && b.cet1[i] > b.tier1[i] + 1e-6) orderFail.push(b.id + '@' + q);
      if (b.tier1[i] != null && b.tier1[i] > b.basel[i] + 1e-6) orderFail.push(b.id + '@' + q + ' tier1>basel');
    });
  });

  // structural breaks: a jump no accounting definition explains
  banks.forEach(b => {
    P.forEach((q, i) => {
      if (i === 0) return;
      if (b.density[i] != null && b.density[i - 1] != null) {
        const d = b.density[i] - b.density[i - 1];
        if (Math.abs(d) > 0.25) breaks.push({ id: b.id, q, field: 'density', from: b.density[i - 1], to: b.density[i] });
      }
      if (b.basel[i] != null && b.basel[i - 1] != null) {
        const d = b.basel[i] - b.basel[i - 1];
        if (Math.abs(d) > 0.05) breaks.push({ id: b.id, q, field: 'basel', from: b.basel[i - 1], to: b.basel[i] });
      }
    });
  });

  // a print repeated to the cent six months later means the source did not update
  const repeats = [];
  banks.forEach(b => P.forEach((q, i) => {
    if (i === 0 || b.prBasis[i] !== 'reported' || b.rwa[i] == null) return;
    for (let j = 0; j < i; j++) {
      if (b.prBasis[j] === 'reported' && b.rwa[j] === b.rwa[i] && b.pr[j] === b.pr[i]) {
        repeats.push({ id: b.id, q, of: P[j], rwa: b.rwa[i], pr: b.pr[i] });
        break;
      }
    }
  }));

  const gapsByBank = BANKS.map(b => {
    const row = banks.find(x => x.id === b.id);
    const n = P.filter((q, i) => row.basel[i] != null).length;
    return { id: b.id, name: b.name, quarters: n };
  }).filter(x => x.quarters < P.length);

  /* ---------- emit ---------- */
  const meta = {
    source: 'BCB IF.Data · Informações de Capital (relatório 5)',
    endpoint: 'https://www3.bcb.gov.br/ifdata/rest/arquivos',
    scope: 'Conglomerados prudenciais e instituições independentes (tipo 1009)',
    retrieved: RETRIEVED,
    periods: P, warmup: WARM,
    accounts: ACCOUNTS,
    units: 'RWA and PR in R$ billion; ratios in decimal',
    floor: 0.105,
    raroc: '12M net income ÷ average Patrimônio de Referência over the five quarter-ends in the window',
    checks: {
      ratioRecomputedMaxErr: Number(maxRatioErr.toFixed(8)),
      ratioPoints: ratioN,
      orderFailures: orderFail.length,
      missingPoints: missing.length,
      structuralJumps: breaks.length,
      repeatPrints: repeats.length,
      filesMissing: missingFiles.length
    },
    coverage: perPeriod,
    gaps: gapsByBank,
    jump: breaks.slice(0, 40),
    repeats,
    filesMissing: missingFiles
  };

  const js = '/* GENERATED by tools/build-capital.js from BCB IF.Data report 5 — do not edit.\n'
    + '   Basel/CET1/Tier1 are reported ratios; RWA and PR in R$ bn.\n'
    + '   PR is reported from 2024-12 onward, derived as Basel x RWA before that.\n'
    + '   RAROC = 12M net income / average PR over five quarter-ends (t-4..t). */\n'
    + 'window.FARO_CAPITAL = ' + JSON.stringify({ meta, periods: P, banks }, null, 0) + ';\n';

  fs.writeFileSync(OUT_JS, js);
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    generated: RETRIEVED,
    selection: 'report 5 (capital), prudential conglomerates, 34 desk institutions + 4 warm-up quarters',
    files,
    checks: meta.checks,
    coverage: perPeriod,
    gaps: gapsByBank,
    jumps: breaks,
    repeats,
    missingFiles
  }, null, 2));

  console.log('assets/capital.js written · ' + js.length + ' bytes');
  console.log('periods ' + P[0] + '..' + P[P.length - 1] + ' · ' + banks.length + ' banks');
  console.log('ratio recompute max err ' + (maxRatioErr * 100).toFixed(4) + ' pp over ' + ratioN + ' points');
  console.log('missing prints ' + missing.length + ' · order failures ' + orderFail.length + ' · jumps >25pp ' + breaks.length);
  console.log('coverage ' + JSON.stringify(perPeriod));
})();
