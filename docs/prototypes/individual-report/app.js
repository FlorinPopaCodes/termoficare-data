// PROTOTYPE -- throwaway. Three structurally different individual-report pages over the
// same real payload, so the choice is made by looking rather than by describing.
//
//   A  Jurnal    live banner, then the record as a reverse-chronological feed.
//   B  Fisa      live strip, then aggregates: stat tiles, month x year heatmaps, city
//                comparison, the record itself behind a disclosure.
//   C  Intrebari the resident's questions in order, each with one answer and its basis.
//
// They deliberately disagree on four things #58 has to settle:
//   1. whether a candidate's record is its whole history or only the span it served this
//      block (A: whole, B: clipped, C: current point only);
//   2. whether an on-time RATE may appear at all, given ADR 0003 (A: never, only per-episode
//      verdicts; B: yes, beside the city rate; C: yes, but counted as misses);
//   3. how 2-4 concurrent candidates are presented (A: stacked, B: tabs, C: pick one first);
//   4. how loud the "we only know what CMTEB published" caveat is (A: footer, B: basis lines,
//      C: its own closing section).

const MONTHS = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec"];
const UTIL = { INC: "Căldură", ACC: "Apă caldă" };
const VARIANTS = [
  { key: "A", name: "Jurnal — cronologic" },
  { key: "B", name: "Fișă — cifre și hărți" },
  { key: "C", name: "Întrebări — răspuns cu răspuns" },
];

// ---------------------------------------------------------------- formatting

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );

const parseTs = (ts) => new Date(ts + "Z");

function fmtDate(ts) {
  const d = parseTs(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtShort(ts) {
  const d = parseTs(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

function fmtDur(h) {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  const days = Math.floor(h / 24);
  const rest = Math.round(h % 24);
  return rest ? `${days} zile ${rest} h` : `${days} zile`;
}

function sinceNow(ts, now) {
  return fmtDur((parseTs(now) - parseTs(ts)) / 3600000);
}

const titleCase = (s) =>
  s.replace(/(^|[ -])([a-zăâîșț])/g, (_, p, c) => p + c.toUpperCase());

const addrTitle = (a) => `${titleCase(a.street)}, bl. ${a.block.toUpperCase()}`;

// ---------------------------------------------------------------- shared pieces

function chip(utility) {
  return `<span class="chip ${utility.toLowerCase()}">${UTIL[utility]}</span>`;
}

function legend() {
  return `<div class="legend">${chip("ACC")}${chip("INC")}</div>`;
}

// The record's own limits, carried with the figure rather than in the prose around it.
function basisLine(cand, extra) {
  const c = DATA.corpus;
  const bits = [
    `${fmtDate(cand.servedSince || c.firstDay + "T00:00:00")} – ${fmtDate(c.lastDay + "T00:00:00")}`,
    `${c.blindDays} zile fără date`,
  ];
  if (extra) bits.push(extra);
  return `<div class="basis">Bază: ${bits.join(" · ")}. Doar întreruperile pe care CMTEB
    le-a publicat.</div>`;
}

function ptLine(cand) {
  const reg = cand.inRegistry
    ? ""
    : ` <span class="muted">(nu apare pe harta CMTEB)</span>`;
  return `<div class="secondary" style="font-size:.9rem">Punct termic
    <strong>${esc(titleCase(cand.pt))}</strong> · sector ${esc(cand.sector)}${reg}</div>`;
}

function clip(cand) {
  // Only the stretch this point actually served the block. The migration address is the
  // case that makes the difference visible: its retired point kept having outages after
  // the block left it.
  if (!cand.servedSince || !cand.servedUntil) return cand.episodes;
  return cand.episodes.filter((e) => e.start >= cand.servedSince && e.start <= cand.servedUntil);
}

// Counted over whichever episodes the variant decided to show, so the figure and its
// basis line can never disagree.
function verdictOfEstimates(eps) {
  let n = 0, hits = 0;
  for (const e of eps) {
    for (const s of e.estimates) {
      n++;
      if (s.hit) hits++;
    }
  }
  return { n, hits, missed: n - hits };
}

function perYear(eps) {
  const out = new Map();
  for (const e of eps) {
    const y = e.start.slice(0, 4);
    out.set(y, (out.get(y) || 0) + 1);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------- charts

function heatmap(episodes, utility) {
  const rows = new Map();
  for (const e of episodes) {
    if (e.utility !== utility) continue;
    const y = e.start.slice(0, 4);
    if (!rows.has(y)) rows.set(y, new Array(12).fill(0));
    rows.get(y)[Number(e.start.slice(5, 7)) - 1]++;
  }
  if (rows.size === 0) return "";
  const years = [...rows.keys()].sort();
  const max = Math.max(...[...rows.values()].flat());
  const ramp = utility === "ACC" ? "acc" : "inc";
  const step = (n) => {
    if (n === 0) return "var(--cell-empty)";
    return `var(--${ramp}-ramp-${Math.min(5, Math.ceil((n / max) * 5))})`;
  };

  let html = `<div class="heat"><span></span>` +
    MONTHS.map((m) => `<span style="text-align:center">${m}</span>`).join("");
  for (const y of years) {
    html += `<span class="rowlab">${y}</span>`;
    for (let m = 0; m < 12; m++) {
      const n = rows.get(y)[m];
      html += `<div class="cell" style="background:${step(n)}" data-tip="${
        MONTHS[m]
      } ${y} · ${n} ${n === 1 ? "întrerupere" : "întreruperi"} · ${UTIL[utility]}"></div>`;
    }
  }
  html += `</div><div class="ramp"><span>0</span>` +
    [1, 2, 3, 4, 5].map((i) => `<i style="background:var(--${ramp}-ramp-${i})"></i>`).join("") +
    `<span>${max}</span></div>`;
  return html;
}

const BUCKETS = [
  { label: "sub 6 h", lo: 0, hi: 6 },
  { label: "6–24 h", lo: 6, hi: 24 },
  { label: "1–3 zile", lo: 24, hi: 72 },
  { label: "3–7 zile", lo: 72, hi: 168 },
  { label: "peste 7 zile", lo: 168, hi: Infinity },
];

// Stacked by utility so the bar keeps the same hue meaning as every chip and heatmap on
// the page; 2px surface gap between the two fills.
function durationBars(episodes) {
  const closed = episodes.filter((e) => e.hours !== null);
  if (closed.length === 0) return "";
  const rows = BUCKETS.map((b) => {
    const inBucket = closed.filter((e) => e.hours >= b.lo && e.hours < b.hi);
    return {
      label: b.label,
      acc: inBucket.filter((e) => e.utility === "ACC").length,
      inc: inBucket.filter((e) => e.utility === "INC").length,
      n: inBucket.length,
    };
  });
  const max = Math.max(...rows.map((r) => r.n)) || 1;
  const seg = (n, total, hue, name) =>
    n === 0 ? "" : `<span style="display:block;height:14px;border-radius:2px;
      background:var(--${hue});width:${(n / max) * 100}%"
      data-tip="${n} ${name} · ${total} în total"></span>`;
  return legend() +
    `<div style="display:grid;grid-template-columns:6.5rem 1fr 2.6rem;gap:4px .6rem;
      align-items:center;font-size:.85rem;margin-top:.4rem">` +
    rows.map((r) =>
      `<span class="secondary">${r.label}</span>
       <span style="display:flex;gap:2px">${seg(r.acc, r.n, "acc", "apă caldă")}${
        seg(r.inc, r.n, "inc", "căldură")
      }</span>
       <span style="font-variant-numeric:tabular-nums">${r.n}</span>`
    ).join("") +
    `</div>`;
}

function recordTable(episodes) {
  return `<table class="record"><thead><tr><th>Început</th><th>Serviciu</th><th>Durată</th>
    <th>Cauză</th></tr></thead><tbody>` +
    episodes.slice().reverse().map((e) =>
      `<tr><td>${fmtDate(e.start)}</td><td>${chip(e.utility)}</td>
       <td>${e.end ? fmtDur(e.hours) : "în curs"}</td>
       <td class="secondary">${esc(e.cause || "—")}</td></tr>`
    ).join("") +
    `</tbody></table>`;
}

// ---------------------------------------------------------------- variant A: Jurnal

function liveBanner(cand) {
  const open = cand.episodes.filter((e) => e.end === null);
  if (open.length === 0) {
    return `<div class="status quiet"><span class="icon">○</span><div>
      <div class="headline">Nimic anunțat acum</div>
      <div class="secondary" style="font-size:.9rem">CMTEB nu are nicio întrerupere publicată
      pentru punctul termic care deservește blocul.</div></div></div>`;
  }
  return open.map((e) => {
    const live = cand.live.find((l) => l.service.includes(e.utility)) || cand.live[0];
    const prob = live && live.probability !== null
      ? `<div class="secondary" style="font-size:.9rem">Din ${live.basis_n} termene comparabile
         anunțate în trecut, ${Math.round(live.probability * live.basis_n)} au fost respectate.</div>`
      : "";
    return `<div class="status out"><span class="icon">▲</span><div>
      <div class="headline">Fără ${e.utility === "ACC" ? "apă caldă" : "căldură"} de
        ${sinceNow(e.start, DATA.scrapedAt)}</div>
      <div class="secondary" style="font-size:.9rem">Din ${fmtDate(e.start)}.
        ${live ? `Termen anunțat: <strong>${fmtDate(live.estimate)}</strong>.` : ""}</div>
      ${live ? `<div class="secondary" style="font-size:.85rem">${esc(live.cause)}</div>` : ""}
      ${prob}</div></div>`;
  }).join("");
}

function feed(cand) {
  const eps = cand.episodes.slice().reverse();
  let html = "";
  let year = null;
  let shown = 0;
  for (const e of eps) {
    const y = e.start.slice(0, 4);
    if (y !== year) {
      year = y;
      const n = cand.episodes.filter((x) => x.start.slice(0, 4) === y).length;
      html += `<div class="year-rule"><strong>${y}</strong><span>${n} întreruperi</span></div>`;
    }
    // A deadline that passed unmet is an observed act, so the feed states it per episode
    // and never as a rate -- ADR 0003's line between measurement and verdict.
    const missed = e.estimates.filter((s) => !s.hit);
    const verdict = e.estimates.length === 0 ? "" : missed.length === 0
      ? `<span class="verdict muted">termen anunțat, respectat</span>`
      : `<span class="verdict" style="color:var(--status-critical)">${
        missed.length === 1
          ? `termenul de ${fmtDate(missed[0].deadline)} a trecut neonorat`
          : `${missed.length} termene anunțate au trecut neonorate`
      }</span>`;
    html += `<div class="ep">
      <span class="when">${fmtShort(e.start)}</span>
      <span>${chip(e.utility)} <span class="dur">${
      e.end ? fmtDur(e.hours) : "în curs"
    }</span></span>
      ${e.cause ? `<span class="cause">${esc(e.cause)}</span>` : ""}
      ${verdict}
    </div>`;
    if (++shown >= 120) {
      html += `<div class="basis">Primele ${shown} din ${cand.episodes.length}
        (prototip: lista completă ar continua).</div>`;
      break;
    }
  }
  return html;
}

function variantA(addr) {
  if (addr.state === "miss") return missPage(addr, "A");
  const head = `<h1>${esc(addrTitle(addr))}</h1>`;
  const intro = addr.candidates.length > 1
    ? `<p class="secondary">Adresa apare la ${addr.candidates.length} puncte termice.
       Nu putem ști care e al tău, așa că mai jos e istoricul fiecăruia, separat.</p>`
    : "";
  return head + intro + legend() + addr.candidates.map((c) => `
    <section class="card">
      ${ptLine(c)}
      <div style="margin:.8rem 0">${liveBanner(c)}</div>
    </section>
    <section>
      ${addr.candidates.length > 1 ? `<h2>${esc(titleCase(c.pt))}</h2>` : ""}
      ${
    addr.state === "migration"
      ? `<p class="secondary">A deservit blocul între ${fmtDate(c.servedSince)} și
           ${fmtDate(c.servedUntil)}.</p>`
      : ""
  }
      ${feed(c)}
      ${basisLine(c)}
    </section>`).join("");
}

// ---------------------------------------------------------------- variant B: Fișă

function tiles(cand, eps) {
  const closed = eps.filter((e) => e.hours !== null).map((e) => e.hours).sort((a, b) => a - b);
  const lastYear = eps.filter((e) => e.start >= isoYearAgo());
  const med = closed.length ? closed[closed.length >> 1] : null;
  const v = verdictOfEstimates(eps);
  const rate = v.n ? Math.round((v.hits / v.n) * 100) : null;
  return `<div class="tiles">
    <div class="tile"><div class="label">Întreruperi în ultimele 12 luni</div>
      <div class="value">${lastYear.length}</div>
      <div class="basis">media pe oraș: ${DATA.city.episodesPerPointPerYear}</div></div>
    <div class="tile"><div class="label">Durată obișnuită (mediană)</div>
      <div class="value">${fmtDur(med)}</div>
      <div class="basis">pe oraș: ${fmtDur(DATA.city.medianHours)}</div></div>
    <div class="tile"><div class="label">Cea mai lungă</div>
      <div class="value">${fmtDur(cand.summary.longestHours)}</div>
      <div class="basis">din ${closed.length} întreruperi încheiate</div></div>
    <div class="tile"><div class="label">Termene respectate</div>
      <div class="value">${rate === null ? "—" : rate + "%"}</div>
      <div class="basis">${v.hits} din ${v.n} · pe oraș:
        ${Math.round(DATA.city.onTimeRate * 100)}%</div></div>
  </div>`;
}

function isoYearAgo() {
  const d = parseTs(DATA.scrapedAt);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 19);
}

function liveStrip(cand) {
  const open = cand.episodes.filter((e) => e.end === null);
  if (open.length === 0) {
    return `<div class="status quiet"><span class="icon">○</span>
      <div><span class="headline">Nimic anunțat acum</span></div></div>`;
  }
  return open.map((e) => {
    const live = cand.live.find((l) => l.service.includes(e.utility)) || cand.live[0];
    return `<div class="status out"><span class="icon">▲</span><div>
      <span class="headline">Fără ${e.utility === "ACC" ? "apă caldă" : "căldură"}</span>
      <span class="secondary"> de ${sinceNow(e.start, DATA.scrapedAt)}${
      live ? ` · termen ${fmtDate(live.estimate)}` : ""
    }</span></div></div>`;
  }).join("");
}

function panelB(cand, addr) {
  const eps = clip(cand);
  return `<section class="card">
      ${ptLine(cand)}
      <div style="margin-top:.7rem">${liveStrip(cand)}</div>
    </section>
    ${
    addr.state === "migration"
      ? `<p class="secondary" style="font-size:.9rem">Cifrele acoperă doar perioada în care
         acest punct termic a deservit blocul: ${fmtDate(cand.servedSince)} –
         ${fmtDate(cand.servedUntil)}.</p>`
      : ""
  }
    ${tiles(cand, eps)}
    ${basisLine(cand, `${eps.length} întreruperi`)}
    <section class="card" style="margin-top:1rem">
      <h2>Când s-au întrerupt</h2>
      ${legend()}
      <div style="font-size:.85rem;color:var(--ink-2);margin:.6rem 0 .3rem">Apă caldă</div>
      ${heatmap(eps, "ACC") || '<div class="muted">—</div>'}
      <div style="font-size:.85rem;color:var(--ink-2);margin:1rem 0 .3rem">Căldură</div>
      ${heatmap(eps, "INC") || '<div class="muted">—</div>'}
    </section>
    <section class="card">
      <h2>Cât au durat</h2>
      ${durationBars(eps)}
    </section>
    <details class="card"><summary>Toate cele ${eps.length} întreruperi</summary>
      ${recordTable(eps)}</details>`;
}

function variantB(addr) {
  if (addr.state === "miss") return missPage(addr, "B");
  const head = `<h1>${esc(addrTitle(addr))}</h1>`;
  if (addr.candidates.length === 1) return head + panelB(addr.candidates[0], addr);
  const sel = state.tab < addr.candidates.length ? state.tab : 0;
  return head +
    `<p class="secondary">Adresa apare la ${addr.candidates.length} puncte termice — cifrele
     nu se pot aduna, așa că sunt separate.</p>` +
    `<div class="tabs" role="tablist">` +
    addr.candidates.map((c, i) =>
      `<button role="tab" aria-selected="${i === sel}" data-tab="${i}">${
        esc(titleCase(c.pt))
      }</button>`
    ).join("") +
    `</div>` + panelB(addr.candidates[sel], addr);
}

// ---------------------------------------------------------------- variant C: Întrebări

function variantC(addr) {
  if (addr.state === "miss") return missPage(addr, "C");
  const head = `<h1>${esc(addrTitle(addr))}</h1>`;

  if (addr.candidates.length > 1 && addr.state !== "migration") {
    if (state.tab >= addr.candidates.length) state.tab = 0;
    if (state.pick === null) {
      return head + `<p class="secondary">Pe această stradă, blocul ${esc(addr.block.toUpperCase())}
        apare la ${addr.candidates.length} puncte termice diferite — sunt clădiri diferite cu
        aceeași etichetă. Alege-l pe al tău ca să vezi răspunsurile.</p>` +
        addr.candidates.map((c, i) =>
          `<button class="card" style="display:block;width:100%;text-align:left;cursor:pointer;
            font:inherit;color:inherit" data-pick="${i}">
            <strong>${esc(titleCase(c.pt))}</strong>
            <div class="secondary" style="font-size:.9rem">sector ${esc(c.sector)} ·
              ${c.summary.total} întreruperi publicate ·
              ultima ${fmtDate(c.summary.lastOutage)}</div></button>`
        ).join("");
    }
  }

  // The migration address answers for the point serving it now; the retired one is a
  // footnote rather than a second record.
  const cand = addr.candidates[addr.state === "migration"
    ? addr.candidates.length - 1
    : (state.pick ?? 0)];
  const retired = addr.state === "migration" ? addr.candidates[0] : null;
  const eps = clip(cand);
  const closed = eps.filter((e) => e.hours !== null).map((e) => e.hours).sort((a, b) => a - b);
  const med = closed.length ? closed[closed.length >> 1] : null;
  const v = verdictOfEstimates(eps);
  const open = cand.episodes.filter((e) => e.end === null);
  const lastYear = eps.filter((e) => e.start >= isoYearAgo());
  const per = perYear(eps).map(([y, n]) => `${y}: ${n}`).join(" · ");

  return head + ptLine(cand) + `
    <div class="qa" style="margin-top:1.4rem">
      <h2>Am apă caldă și căldură acum?</h2>
      <div class="answer">${
    open.length === 0
      ? "Nu e anunțată nicio întrerupere."
      : open.map((e) =>
        `Nu — fără ${e.utility === "ACC" ? "apă caldă" : "căldură"} de ${
          sinceNow(e.start, DATA.scrapedAt)
        }.`
      ).join(" ")
  }</div>
      ${
    open.length
      ? `<p>Termen anunțat de CMTEB: ${
        cand.live[0] ? fmtDate(cand.live[0].estimate) : "—"
      }. Termenele anunțate pentru acest punct termic au fost depășite de ${v.missed} ori
        din ${v.n}.</p>`
      : `<p>Asta înseamnă că CMTEB nu a publicat nimic — nu că instalația e sigur în funcțiune.</p>`
  }
    </div>

    <div class="qa">
      <h2>Cât de des se întrerupe?</h2>
      <div class="answer">${lastYear.length} întreruperi în ultimele 12 luni</div>
      <p>Pe ani: ${per}. Media pe oraș este ${DATA.city.episodesPerPointPerYear} pe an.</p>
      ${basisLine(cand)}
    </div>

    <div class="qa">
      <h2>Cât durează?</h2>
      <div class="answer">de obicei ${fmtDur(med)}</div>
      <p>Jumătate din întreruperi se încheie mai repede de atât. Una din zece trece de
        ${fmtDur(cand.summary.p90Hours)}, iar cea mai lungă a ținut
        ${fmtDur(cand.summary.longestHours)}.</p>
      ${durationBars(eps)}
    </div>

    <div class="qa">
      <h2>Se ține CMTEB de termenul anunțat?</h2>
      <div class="answer">${v.missed} termene depășite din ${v.n}</div>
      <p>Un termen e considerat depășit dacă întreruperea era încă publicată după ora anunțată —
        fără marjă de toleranță. Pe tot orașul, ${
    Math.round((1 - DATA.city.onTimeRate) * 100)
  }% din termene sunt depășite.</p>
      ${basisLine(cand)}
    </div>

    <div class="qa">
      <h2>Ce nu putem spune</h2>
      <p>Tot ce e mai sus vine din ce a publicat CMTEB pe pagina de avarii, citită la fiecare
        15 minute din ${fmtDate(DATA.corpus.firstDay + "T00:00:00")}. O întrerupere nepublicată
        nu apare aici, iar în ${DATA.corpus.blindDays} zile nu am putut citi pagina deloc.
        Un istoric curat nu înseamnă că nu au fost avarii.</p>
      ${
    retired
      ? `<p>Până în ${
        fmtDate(retired.servedUntil)
      }, blocul a fost trecut la punctul termic
        ${esc(titleCase(retired.pt))}. Întreruperile de dinainte de acea dată sunt ale lui.</p>`
      : ""
  }
      <details><summary>Toate cele ${eps.length} întreruperi</summary>${
    recordTable(eps)
  }</details>
    </div>`;
}

// ---------------------------------------------------------------- the miss page

function missPage(addr, variant) {
  const nearby = addr.streetPoints;
  const head = `<h1>${esc(addrTitle(addr))}</h1>`;
  const core = `<div class="status quiet"><span class="icon">○</span><div>
      <div class="headline">Nicio întrerupere publicată la această adresă</div>
      <div class="secondary" style="font-size:.9rem">Asta nu înseamnă că nu au fost avarii.
      Înseamnă doar că CMTEB nu a publicat niciuna pentru acest bloc — o avarie nepublicată
      și o zi în care nu am putut citi pagina arată exact la fel de aici.</div></div></div>`;
  const list = nearby.length
    ? `<section class="card"><h2>Ce știm despre ${esc(titleCase(addr.street))}</h2>
       <p class="secondary" style="font-size:.9rem">Pe stradă apar
       ${nearby.length} puncte termice. Blocul tău e deservit, aproape sigur, de unul dintre
       ele — dar nu putem spune care.</p>
       <table class="record"><tbody>${
      nearby.map((p) =>
        `<tr><td>${esc(titleCase(p.pt))}</td><td class="secondary">ultima mențiune
         ${fmtDate(p.last)}</td></tr>`
      ).join("")
    }</tbody></table></section>`
    : "";
  const tail = `<div class="basis">Indexul acoperă ${DATA.corpus.addresses.toLocaleString("ro")}
    adrese care au apărut cel puțin o dată într-o avarie publicată, între
    ${fmtDate(DATA.corpus.firstDay + "T00:00:00")} și
    ${fmtDate(DATA.corpus.lastDay + "T00:00:00")}.</div>`;
  if (variant === "C") {
    return head + `<div class="qa"><h2>Am apă caldă și căldură acum?</h2>
      <div class="answer">Nu știm.</div>
      <p>Nu am găsit nicio întrerupere publicată vreodată pentru acest bloc. Nu putem
      deosebi asta de o avarie pe care CMTEB nu a publicat-o.</p></div>` + list + tail;
  }
  return head + `<section class="card">${core}</section>` + list + tail;
}

// ---------------------------------------------------------------- switcher

const state = { variant: "A", addr: 0, tab: 0, pick: null };

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.variant = (q.get("variant") || "A").toUpperCase();
  if (!VARIANTS.some((v) => v.key === state.variant)) state.variant = "A";
  state.addr = Math.min(Math.max(0, Number(q.get("addr") || 0)), DATA.addresses.length - 1);
}

function writeUrl() {
  const q = new URLSearchParams();
  q.set("variant", state.variant);
  q.set("addr", String(state.addr));
  history.replaceState(null, "", "?" + q.toString());
}

function render() {
  const addr = DATA.addresses[state.addr];
  const body = { A: variantA, B: variantB, C: variantC }[state.variant](addr);
  document.getElementById("page").innerHTML = body;
  const v = VARIANTS.find((x) => x.key === state.variant);
  document.querySelector("#bar .name").textContent = `${v.key} — ${v.name}`;
  document.getElementById("head").textContent =
    `PROTOTIP · ${addr.why} · date reale până la ${DATA.corpus.lastDay} · ${DATA.note}`;
  writeUrl();
}

function step(delta) {
  const i = VARIANTS.findIndex((v) => v.key === state.variant);
  state.variant = VARIANTS[(i + delta + VARIANTS.length) % VARIANTS.length].key;
  state.tab = 0;
  state.pick = null;
  render();
}

addEventListener("DOMContentLoaded", () => {
  readUrl();
  const sel = document.getElementById("addr");
  sel.innerHTML = DATA.addresses.map((a, i) =>
    `<option value="${i}">${esc(addrTitle(a))} — ${esc(a.why)}</option>`
  ).join("");
  sel.value = String(state.addr);
  sel.addEventListener("change", () => {
    state.addr = Number(sel.value);
    state.tab = 0;
    state.pick = null;
    render();
  });
  document.getElementById("prev").addEventListener("click", () => step(-1));
  document.getElementById("next").addEventListener("click", () => step(1));
  addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  document.getElementById("page").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      state.tab = Number(tab.dataset.tab);
      render();
      return;
    }
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      state.pick = Number(pick.dataset.pick);
      render();
    }
  });

  const tip = document.getElementById("tip");
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) {
      tip.style.opacity = "0";
      return;
    }
    tip.textContent = el.dataset.tip;
    tip.style.opacity = "1";
  });
  document.addEventListener("mousemove", (e) => {
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + "px";
    tip.style.top = e.clientY + 18 + "px";
  });

  render();
});
