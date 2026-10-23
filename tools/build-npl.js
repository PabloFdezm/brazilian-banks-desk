/* Build assets/npl.js from BCB IF.Data report 130
   "Carteira de crédito ativa - por carteiras de instrumentos financeiros"
   (prudential conglomerates and independent institutions, type 1009).

   Source: https://www3.bcb.gov.br/ifdata/rest/arquivos
     ifdata_2025_2030//YYYYMM/dadosYYYYMM_3.json   (id 3 = credit block files)
     ifdata_2025_2030//YYYYMM/infoYYYYMM.json      (account dictionary)

   Why this report: it is the only IF.Data table that prints a defaulted
   portfolio balance per institution. Report 67 ("por nível de risco") is a
   regulatory grading (AA..H), not a 90-day measure, and it stops at 2024 Q4.

   Definition used, exactly as filed:
     npl90 = "Carteira ativa inadimplida arrastada" (account 148834)
             ÷ "Total Geral" of the active credit portfolio (account 24454)

   The identity Total Geral = C1..C5 + not-informed + not-individualised +
   overseas is verified per institution and per quarter before anything is
   emitted. A missing print stays null; nothing is interpolated.

   Run: node tools/build-npl.js [--refresh]
*/
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'ifdata-npl');
const OUT_JS = path.join(ROOT, 'assets', 'npl.js');
const OUT_JSON = path.join(ROOT, 'assets', 'npl-provenance.json');
const REFRESH = process.argv.includes('--refresh');
const RETRIEVED = new Date().toISOString();
const FIRST = '202503';

/* column ids as filed in dados*_3.json (info table ids, not display order) */
const ACC = {
  total: 24454,      // Total Geral
  defaulted: 148834, // Inadimplência — carteira ativa inadimplida arrastada
  problem: 148833,   // Ativos problemáticos
  foreign: 23383,    // Total Exterior
  uninformed: 149385,// Carteira não informada ou não se aplica
  pooled: 24457,     // Total não individualizado
  c1: 148835, c2: 148836, c3: 148837, c4: 148838, c5: 148839
};

const dataSrc = fs.readFileSync(path.join(ROOT, 'assets', 'data.js'), 'utf8');
const jsonText = dataSrc.slice(dataSrc.indexOf('{'), dataSrc.lastIndexOf('}') + 1);
const FARO = JSON.parse(jsonText);
const P = FARO.periods.slice();
const BANKS = FARO.banks;
const QS = P.filter(q => q >= FIRST);

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const urlFor = name => 'https://www3.bcb.gov.br/ifdata/rest/arquivos?nomeArquivo='
  + encodeURIComponent('ifdata_2025_2030//' + name.slice(5, 11) + '/' + name);
/* dadosYYYYMM_3.json -> period is chars 5..11 */
const periodOf = name => name.slice(5, 11);

if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

async function get(name) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && !REFRESH) return { buf: fs.readFileSync(file), cached: true };
  const url = urlFor(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FARO-npl/1.0' } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length > 1000 && buf[0] === 0x7b) {
      fs.writeFileSync(file, buf);
      await sleep(300);
      return { buf, cached: false };
    }
    await sleep(1200 * (attempt + 1));
  }
  return { buf: null };
}

const dec = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const val = (acc, id) => {
  const hit = acc.get(id);
  return dec(hit);
};

(async () => {
  const files = {};
  const byPeriod = new Map();
  const missingFiles = [];

  for (const q of QS) {
    const name = 'dados' + q + '_3.json';
    const res = await get(name);
    if (!res.buf) { missingFiles.push(name); continue; }
    files[name] = {
      url: urlFor(name), bytes: res.buf.length, sha256: sha(res.buf),
      cached: !!res.cached, retrieved: RETRIEVED
    };
    const d = JSON.parse(res.buf.toString('utf8'));
    const byE = new Map();
    d.values.forEach(x => {
      const acc = new Map();
      x.v.forEach(v => acc.set(Number(v.i), v.v));
      byE.set(Number(x.e), acc);
    });
    byPeriod.set(q, byE);
  }

  /* entity code in the credit file -> desk bank id (C0 + last six digits) */
  const codeOf = b => Number('1000' + b.id.slice(2));

  const rows = [];
  const findings = [];
  let identityOk = 0, identityFail = 0, points = 0, missing = 0, repeats = 0, zeros = 0;
  const zerosList = [];
  const jumps = [];
  const coverage = [];
  const system = P.map(() => null);
  const systemBook = P.map(() => null);

  BANKS.forEach(b => {
    const code = codeOf(b);
    const npl = P.map(() => null);
    const book = P.map(() => null);
    const defd = P.map(() => null);
    const prob = P.map(() => null);
    const probRatio = P.map(() => null);

    P.forEach((q, i) => {
      const byE = byPeriod.get(q);
      if (!byE) return;
      const acc = byE.get(code);
      if (!acc) { missing++; return; }
      const total = val(acc, ACC.total);
      const ina = val(acc, ACC.defaulted);
      if (total == null || ina == null || total <= 0) { missing++; return; }

      /* additive check: the components must rebuild the reported total */
      const parts = [ACC.c1, ACC.c2, ACC.c3, ACC.c4, ACC.c5, ACC.uninformed, ACC.pooled, ACC.foreign]
        .map(id => val(acc, id) || 0).reduce((s, v) => s + v, 0);
      const diff = parts - total;
      if (Math.abs(diff) < Math.max(1000, total * 1e-9)) identityOk++;
      else {
        identityFail++;
        findings.push({ id: b.id, q, field: 'npl90', rule: 'npl_identity', diff, total });
      }

      /* a zero defaulted balance on a real book is a filing, not a fact:
         the ratio is kept null and the print is listed, never smoothed */
      if (ina === 0 && total / 1e9 > 1) {
        zeros++;
        zerosList.push({ id: b.id, q, book: total / 1e9, rule: 'npl_zero' });
        book[i] = total / 1e9;
        const pr0 = val(acc, ACC.problem);
        prob[i] = pr0 == null ? null : pr0 / 1e9;
        probRatio[i] = pr0 == null ? null : pr0 / total;
        return;
      }

      npl[i] = ina / total;
      book[i] = total / 1e9;
      defd[i] = ina / 1e9;
      const pr = val(acc, ACC.problem);
      prob[i] = pr == null ? null : pr / 1e9;
      probRatio[i] = pr == null ? null : pr / total;
      points++;
    });

    /* scope jumps: a default ratio that moves more than 5pp without the book moving */
    P.forEach((q, i) => {
      if (i === 0 || npl[i] == null || npl[i - 1] == null || !book[i] || !book[i - 1]) return;
      const d = npl[i] - npl[i - 1];
      const bookMove = Math.abs(book[i] / book[i - 1] - 1);
      if (Math.abs(d) > 0.05 && bookMove < 0.30) {
        jumps.push({ id: b.id, q, from: npl[i - 1], to: npl[i], book: book[i] });
      }
    });

    /* a print repeated to the cent is a stale filing */
    P.forEach((q, i) => {
      if (i === 0 || defd[i] == null) return;
      for (let j = 0; j < i; j++) {
        if (defd[j] != null && defd[j] === defd[i] && book[j] === book[i]) { repeats++; break; }
      }
    });

    rows.push({ id: b.id, name: b.name, npl90: npl, book, defd, problem: prob, problemRatio: probRatio });
  });

  /* cohort aggregate, credit-weighted, only over banks with a print */
  P.forEach((q, i) => {
    let d = 0, t = 0;
    rows.forEach(r => {
      if (r.npl90[i] == null) return;
      d += r.defd[i]; t += r.book[i];
    });
    system[i] = t ? d / t : null;
    systemBook[i] = t || null;
    coverage.push({
      q,
      banks: rows.filter(r => r.npl90[i] != null).length,
      book: Math.round(t),
      npl90: system[i]
    });
  });

  const qLast = P[P.length - 1];
  const lastCov = coverage[coverage.length - 1];
  const meta = {
    source: 'BCB IF.Data · Carteira de crédito ativa por carteiras de instrumentos financeiros (relatório 130)',
    endpoint: 'https://www3.bcb.gov.br/ifdata/rest/arquivos',
    scope: 'Conglomerados prudenciais e instituições independentes (tipo 1009)',
    retrieved: RETRIEVED,
    periods: P,
    firstPeriod: FIRST,
    definition: 'Carteira ativa inadimplida arrastada ÷ total da carteira ativa de crédito, ambas como reportadas (SCR, documento 3040)',
    concept: 'Instrumento financeiro inadimplente no sentido da Res. BCB 4.966 — parcela em atraso há mais de 90 dias. A coluna é a carteira inadimplida que permanece ativa (não baixada), não a despesa de provisão.',
    basis: 'SCR por instituição, não o balanço Cosif. A soma do relatório não reproduz necessariamente o total da modalidade no sistema financeiro — o próprio IF.Data diz isso na nota do relatório.',
    units: 'npl90 e problemRatio em decimal; book, defd e problem em R$ bilhões',
    accounts: ACC,
    checks: {
      identityOk,
      identityFail,
      points,
      missing,
      zeroPrints: zeros,
      jumps: jumps.length,
      repeats,
      filesMissing: missingFiles.length,
      banksLast: lastCov ? lastCov.banks : 0,
      bookLast: lastCov ? lastCov.book : 0
    },
    coverage,
    jump: jumps.slice(0, 40),
    zeros: zerosList,
    filesMissing: missingFiles
  };

  const js = '/* GENERATED by tools/build-npl.js from BCB IF.Data report 130 — do not edit.\n'
    + '   npl90 = defaulted portfolio / total active credit portfolio, per institution.\n'
    + '   Published from 2025 Q1 only; earlier quarters are null, never interpolated. */\n'
    + 'window.FARO_NPL = ' + JSON.stringify({ meta, periods: P, system, systemBook, banks: rows }, null, 0) + ';\n';

  fs.writeFileSync(OUT_JS, js);
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    generated: RETRIEVED,
    selection: 'report 130 (credit by financial-instrument portfolio), type 1009, 6 quarters',
    files,
    checks: meta.checks,
    coverage,
    jumps,
    zeros: zerosList,
    filesMissing: missingFiles
  }, null, 2));

  console.log('assets/npl.js written · ' + js.length + ' bytes');
  console.log('quarters ' + QS[0] + '..' + QS[QS.length - 1] + ' · ' + rows.length + ' banks');
  console.log('points ' + points + ' · identity ok ' + identityOk + ' fail ' + identityFail + ' · missing ' + missing);
  console.log('jumps >5pp ' + jumps.length + ' · repeated prints ' + repeats + ' · zero prints kept as gaps ' + zeros);
  coverage.forEach(c => console.log('  ' + c.q + ' banks ' + c.banks + ' book R$ ' + c.book + ' bn npl90 ' + (c.npl90 * 100).toFixed(2) + '%'));
})();
