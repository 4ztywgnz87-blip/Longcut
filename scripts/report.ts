// Builds eval/out/report.html from results.json and the map images.
// Usage: npx tsx scripts/report.ts
import { readFile, writeFile } from 'node:fs/promises';
import type { PlanResult } from '../src/core/types';

interface Row {
  id: number;
  from: string;
  to: string;
  km: number;
  seconds: number;
  requests: number;
  result: PlanResult;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (x: number, sign = false) => `${sign && x > 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`;
const km = (m: number) => (m / 1000).toFixed(2).replace('.', ',');
const short = (s: string) => s.replace(', Sint-Niklaas', '').replace(', Antwerpen', '').replace(', Gent', '').replace('Grote Markt', 'Sint-Niklaas (Grote Markt)');

type Verdict = 'good' | 'ok' | 'bad' | 'info';
function verdict(r: Row): [Verdict, string] {
  const res = r.result;
  if (!res.ok) {
    if (res.reason === 'too-short') return ['info', `Correct gemeld: kortste route is ${res.shortestKm.toFixed(1).replace('.', ',')} km`];
    return ['bad', 'Geen route gevonden'];
  }
  const d = res.routes[0].deviation;
  if (d >= 0 && d <= 0.03) return ['good', 'Binnen 0 tot +3%'];
  if (Math.abs(d) <= 0.05) return ['ok', 'Binnen ±5%'];
  return ['bad', 'Buiten de marge'];
}

async function main() {
  const rows = JSON.parse(await readFile('eval/out/results.json', 'utf8')) as Row[];
  const planned = rows.filter((r) => r.result.ok);
  const bests = planned.map((r) => (r.result.ok ? r.result.routes[0] : null)!);
  const allRoutes = planned.flatMap((r) => (r.result.ok ? r.result.routes : []));
  const within5 = bests.filter((b) => Math.abs(b.deviation) <= 0.05).length;
  const within3 = bests.filter((b) => b.deviation >= 0 && b.deviation <= 0.03).length;
  const altsOk = allRoutes.filter((b) => Math.abs(b.deviation) <= 0.05).length;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const avgAbsDev = avg(bests.map((b) => Math.abs(b.deviation)));
  const avgBusy = avg(bests.map((b) => b.stats.busyShare));
  const avgOverlap = avg(bests.map((b) => b.stats.overlapShare));
  const avgReq = avg(planned.map((r) => r.requests));

  const cards = [];
  for (const r of rows) {
    const [v, label] = verdict(r);
    const img = await readFile(`eval/out/img/${r.id}.jpg`).then((b) => b.toString('base64')).catch(() => '');
    const loop = r.from === r.to;
    const routes = r.result.ok ? r.result.routes : [];
    const table = routes.length
      ? `<div class="tbl"><table>
          <thead><tr><th></th><th>Afstand</th><th>Afwijking</th><th>Drukke weg</th><th>Dubbel</th><th>Onverhard</th><th>Hoogte</th></tr></thead>
          <tbody>${routes
            .map(
              (x, i) => `<tr><td><span class="sw s${i}"></span>${i === 0 ? 'Voorstel' : `Alt. ${i}`}</td>
              <td>${km(x.stats.length)} km</td><td>${pct(x.deviation, true)}</td><td>${pct(x.stats.busyShare)}</td>
              <td>${pct(x.stats.overlapShare)}</td><td>${pct(x.stats.unpavedShare)}</td><td>${x.stats.ascent} m</td></tr>`,
            )
            .join('')}</tbody></table></div>`
      : '';
    cards.push(`<article class="trip" id="t${r.id}">
      <header>
        <div class="route-name"><span class="num">#${r.id}</span>
          <h3>${esc(short(r.from))} ${loop ? '<span class="arrow">↻</span> lus' : `<span class="arrow">→</span> ${esc(short(r.to))}`}</h3></div>
        <div class="target"><b>${r.km}</b> km gevraagd</div>
      </header>
      <p class="verdict v-${v}">${label}${r.result.ok ? ` · ${routes.length} ${routes.length === 1 ? 'route' : 'routes'}` : ''}</p>
      ${img ? `<img src="data:image/jpeg;base64,${img}" alt="Kaart van traject ${r.id}" loading="lazy" width="960" height="600">` : ''}
      ${table}
    </article>`);
  }

  const html = `<title>LONGCUT Testrapport</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800&family=Barlow:wght@400;500;600&display=swap">
<style>
/* Layout: one narrow column of trip cards, like a training log; numbers set in condensed type like a watch face. */
:root {
  color-scheme: dark;
  --bg: #121214; --panel: #1A1A1E; --line: #2A2A31; --fg: #ECECEF; --muted: #9A9AA6;
  --volt: #D7FF3A; --blue: #6EC8FF; --pink: #FF8FD8;
  --good: #7BE38A; --ok: #F2C94C; --bad: #FF6B6B; --info: #8FB8FF;
  --display: 'Barlow Condensed', 'Arial Narrow', sans-serif;
  --body: 'Barlow', system-ui, sans-serif;
}
body { background: var(--bg); color: var(--fg); font-family: var(--body); font-size: 15px; line-height: 1.5;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap { max-width: 980px; margin: 0 auto; padding-block: 40px 64px; display: grid; gap: 40px; }
.brand { font-family: var(--display); font-weight: 800; letter-spacing: .06em; font-size: 15px; color: var(--volt); text-transform: uppercase; }
h1 { font-family: var(--display); font-weight: 800; font-size: clamp(40px, 8vw, 72px); line-height: .95; margin: 8px 0 12px; text-transform: uppercase; text-wrap: balance; }
.lede { color: var(--muted); max-width: 62ch; margin: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.stat { background: var(--panel); padding: 16px 18px; display: grid; gap: 2px; }
.stat b { font-family: var(--display); font-weight: 800; font-size: 40px; line-height: 1; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 13px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 13px; margin: 0; padding: 0; list-style: none; }
.legend li { display: flex; align-items: center; gap: 8px; }
.sw { display: inline-block; width: 18px; height: 4px; border-radius: 2px; vertical-align: middle; margin-right: 8px; }
.legend .sw { margin: 0; }
.s0 { background: var(--volt); } .s1 { background: var(--blue); } .s2 { background: var(--pink); }
.sb1 { background: #FF3B3B; } .sb2 { background: #FF9A3B; }
.dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--fg); }
.dot.start { background: var(--fg); } .dot.end { background: var(--bg); }
section h2 { font-family: var(--display); font-weight: 600; text-transform: uppercase; letter-spacing: .08em; font-size: 15px; color: var(--muted); margin: 0 0 12px; }
.notes { display: grid; gap: 10px; margin: 0; padding-left: 20px; max-width: 70ch; }
.trips { display: grid; gap: 28px; }
.trip { display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 18px; min-width: 0; }
.trip header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.route-name { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.num { font-family: var(--display); color: var(--muted); font-size: 18px; }
.trip h3 { font-family: var(--display); font-weight: 600; font-size: 24px; margin: 0; text-wrap: balance; }
.arrow { color: var(--muted); }
.target { color: var(--muted); }
.target b { font-family: var(--display); font-weight: 800; font-size: 30px; color: var(--fg); font-variant-numeric: tabular-nums; }
.verdict { margin: 0; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.verdict::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.v-good { color: var(--good); } .v-ok { color: var(--ok); } .v-bad { color: var(--bad); } .v-info { color: var(--info); }
.trip img { width: 100%; height: auto; border-radius: 6px; display: block; background: var(--panel); }
.tbl { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 14px; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; padding: 6px 10px 6px 0; white-space: nowrap; }
td { padding: 6px 10px 6px 0; border-top: 1px solid var(--line); white-space: nowrap; }
</style>
<div class="wrap">
  <header>
    <div class="brand">Longcut · fase 1</div>
    <h1>Testrapport routeberekening</h1>
    <p class="lede">${rows.length} echte trajecten in het Waasland, Antwerpen en Gent, van 4 tot 100 km. Per traject: het voorstel en tot 2 alternatieven, met de afwijking van de gevraagde afstand en hoeveel van de route over drukke wegen gaat.</p>
  </header>

  <div class="stats">
    <div class="stat"><b>${within5}/${planned.length}</b><span>voorstellen binnen ±5%</span></div>
    <div class="stat"><b>${within3}/${planned.length}</b><span>binnen 0 tot +3% (ideaal)</span></div>
    <div class="stat"><b>${pct(avgAbsDev)}</b><span>gemiddelde afwijking</span></div>
    <div class="stat"><b>${pct(avgBusy)}</b><span>gemiddeld op drukke wegen</span></div>
    <div class="stat"><b>${pct(avgOverlap)}</b><span>gemiddeld dubbel gelopen</span></div>
  </div>

  <section>
    <h2>Zo lees je de kaarten</h2>
    <ul class="legend">
      <li><span class="sw s0"></span>Voorstel</li>
      <li><span class="sw s1"></span>Alternatief 1</li>
      <li><span class="sw s2"></span>Alternatief 2</li>
      <li><span class="sw sb1"></span>Voorstel op hoofdweg</li>
      <li><span class="sw sb2"></span>Voorstel op gewestweg</li>
      <li><span class="dot start"></span>Start</li>
      <li><span class="dot end"></span>Einde</li>
    </ul>
  </section>

  <section>
    <h2>Opmerkingen</h2>
    <ul class="notes">
      <li>"Drukke weg" telt hoofdwegen volledig en gewestwegen (secundair/tertiair) voor de helft mee. Vaak heeft zo'n stuk een fietspad of voetpad ernaast.</li>
      <li>Routes komen van BRouter met een eigen profiel voor lopers, op OpenStreetMap-kaartdata.</li>
      <li>Gemiddeld ${Math.round(avgReq)} routeberekeningen per voorstel. ${altsOk}/${allRoutes.length} getoonde routes (voorstel + alternatieven) zitten binnen ±5%.</li>
    </ul>
  </section>

  <section class="trips">
    <h2>Alle trajecten</h2>
    ${cards.join('\n')}
  </section>
</div>`;
  await writeFile('eval/out/report.html', html);
  console.log(`Wrote eval/out/report.html (${(html.length / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
