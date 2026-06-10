'use strict';

const POLL_USAGE_MS = 5000;
const POLL_ADMIN_MS = 60000;

const MODEL_COLORS = {
  opus: '#d4a35a',
  sonnet: '#58a6ff',
  haiku: '#3fb950',
  fable: '#bc8cff',
};
function modelColor(name) {
  for (const k of Object.keys(MODEL_COLORS)) if (name.includes(k)) return MODEL_COLORS[k];
  return '#8b949e';
}

// ---- formatting helpers ----
const fmtUSD = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtTokens(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtDuration(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}
function projectLabel(p) {
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || p;
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// ---- KPI cards ----
function renderKPIs(s) {
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = s.byDay.find((d) => d.key === today);
  const todayCost = todayRow ? todayRow.cost : 0;
  const burn = s.window && s.window.active ? s.window.burn.costPerMin * 60 : 0;
  const cards = [
    { label: 'Total cost', value: fmtUSD(s.total.cost), sub: `${s.total.count.toLocaleString()} messages` },
    { label: 'Total tokens', value: fmtTokens(s.total.totalTokens), sub: `${fmtTokens(s.total.tokens)} non-cache` },
    { label: 'Today', value: fmtUSD(todayCost), sub: today },
    { label: 'Burn rate', value: burn ? fmtUSD(burn) + '/h' : '—', sub: s.window && s.window.active ? 'current window' : 'idle' },
  ];
  const root = document.getElementById('kpis');
  root.innerHTML = '';
  for (const c of cards) {
    const k = el('div', 'kpi');
    k.appendChild(el('div', 'label', c.label));
    k.appendChild(el('div', 'value', c.value));
    k.appendChild(el('div', 'sub2', c.sub));
    root.appendChild(k);
  }
}

// ---- 5-hour window ----
function renderWindow(s) {
  const body = document.getElementById('windowBody');
  const resetEl = document.getElementById('windowReset');
  const w = s.window;
  if (!w) {
    body.innerHTML = '<p class="empty">No recent activity.</p>';
    resetEl.textContent = '—';
    return;
  }
  const pct = Math.min(100, (w.elapsedMin / (5 * 60)) * 100);
  resetEl.textContent = w.active
    ? `resets in ${fmtDuration(w.remainingMin)}`
    : 'window closed';

  body.innerHTML = '';
  const gauge = el('div', 'gauge');
  gauge.innerHTML = `
    <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%"></div></div>
    <div class="gauge-labels"><span>window start</span><span>${Math.round(pct)}% elapsed</span><span>+5h</span></div>`;
  body.appendChild(gauge);

  const stats = el('div', 'window-stats');
  const items = [
    ['Spent this window', fmtUSD(w.totals.cost)],
    ['Tokens this window', fmtTokens(w.totals.totalTokens)],
    ['Burn', w.active ? `${fmtTokens(w.burn.tokensPerMin * 60)}/h` : '—'],
    ['Projected by reset', w.active ? fmtUSD(w.burn.projectedCost) : '—'],
  ];
  for (const [label, value] of items) {
    const d = el('div', 'wstat');
    d.appendChild(el('div', 'label', label));
    d.appendChild(el('div', 'value', value));
    stats.appendChild(d);
  }
  body.appendChild(stats);
}

// ---- horizontal bar lists ----
function renderBars(containerId, rows, labelFn, colorFn) {
  const root = document.getElementById(containerId);
  root.innerHTML = '';
  if (!rows.length) {
    root.appendChild(el('p', 'empty', 'No data.'));
    return;
  }
  const max = Math.max(...rows.map((r) => r.cost), 0.0001);
  const wrap = el('div', 'bars');
  for (const r of rows.slice(0, 8)) {
    const row = el('div', 'bar-row');
    const name = el('div', 'name', labelFn(r.key));
    name.title = r.key;
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = (r.cost / max) * 100 + '%';
    if (colorFn) fill.style.background = colorFn(r.key);
    track.appendChild(fill);
    const amt = el('div', 'amt', `${fmtUSD(r.cost)} <small>· ${fmtTokens(r.totalTokens)}</small>`);
    row.append(name, track, amt);
    wrap.appendChild(row);
  }
  root.appendChild(wrap);
}

// ---- by-day table ----
function renderDays(s) {
  const root = document.getElementById('byDay');
  const rows = [...s.byDay].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 14);
  root.innerHTML = '';
  if (!rows.length) { root.appendChild(el('p', 'empty', 'No data.')); return; }
  const t = el('table');
  t.innerHTML = '<thead><tr><th>Date</th><th>Cost</th><th>Tokens</th><th>Messages</th></tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.innerHTML = `<td>${r.key}</td><td>${fmtUSD(r.cost)}</td><td>${fmtTokens(r.totalTokens)}</td><td>${r.count}</td>`;
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  root.appendChild(t);
}

// ---- trend chart ----
let chart;
function renderTrend(s) {
  const canvas = document.getElementById('trendChart');
  if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<p class="empty">Chart library unavailable (offline).</p>'; return; }
  const labels = s.hourly.map((h) => {
    const d = new Date(h.hour);
    return d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getHours()).padStart(2, '0')}h`;
  });
  const data = s.hourly.map((h) => h.tokens);
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('none');
    return;
  }
  chart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#d4a35a', borderRadius: 3, barThickness: 'flex', maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: (c) => fmtTokens(c.parsed.y) + ' tokens' } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b949e', maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 10 } } },
        y: { grid: { color: '#283039' }, ticks: { color: '#8b949e', callback: (v) => fmtTokens(v), font: { size: 10 } } },
      },
    },
  });
}

// ---- admin panel ----
function renderAdmin(a) {
  const body = document.getElementById('adminBody');
  const sub = document.getElementById('adminSub');
  if (!a || !a.configured) {
    sub.textContent = 'not configured';
    body.innerHTML = `<p class="empty">Set <code>ANTHROPIC_ADMIN_KEY</code> (an <code>sk-ant-admin…</code> key from an organization) and restart to see org-level API usage &amp; cost here. Not available for individual Pro/Max accounts.</p>`;
    return;
  }
  const usageErr = a.usage && a.usage.error;
  const costErr = a.cost && a.cost.error;
  if (usageErr && costErr) {
    sub.textContent = 'error';
    body.innerHTML = `<p class="empty">Admin API error: ${usageErr}. ${a.usage.detail && a.usage.detail.error ? a.usage.detail.error.message || '' : ''} (Org admin key required; individual accounts can't use this API.)</p>`;
    return;
  }
  sub.textContent = 'org-level · last 7–30 days';
  let html = '';

  // Cost report
  if (a.cost && Array.isArray(a.cost.data)) {
    let total = 0;
    const byDesc = {};
    for (const bucket of a.cost.data) {
      for (const r of bucket.results || []) {
        const amt = parseFloat(r.amount || r.cost || 0) / 100; // cents → USD
        total += amt;
        const key = (r.description && r.description.model) || r.description || 'API';
        byDesc[key] = (byDesc[key] || 0) + amt;
      }
    }
    html += `<div class="kpi" style="margin-bottom:14px"><div class="label">API cost (30d)</div><div class="value">${fmtUSD(total)}</div></div>`;
    const rows = Object.entries(byDesc).sort((x, y) => y[1] - x[1]).slice(0, 6);
    if (rows.length) {
      html += '<table><thead><tr><th>Description</th><th>Cost</th></tr></thead><tbody>';
      for (const [k, v] of rows) html += `<tr><td>${k}</td><td>${fmtUSD(v)}</td></tr>`;
      html += '</tbody></table>';
    }
  } else if (costErr) {
    html += `<p class="empty">Cost report: ${costErr}</p>`;
  }
  body.innerHTML = html || '<p class="empty">No org usage in range.</p>';
}

// ---- polling ----
async function tickUsage() {
  try {
    const r = await fetch('/api/usage');
    const s = await r.json();
    if (s.error) throw new Error(s.error);
    renderKPIs(s);
    renderWindow(s);
    renderBars('byModel', s.byModel, (k) => k.replace('claude-', ''), modelColor);
    renderBars('byProject', s.byProject, projectLabel, null);
    renderDays(s);
    renderTrend(s);
    document.getElementById('updated').textContent =
      'updated ' + new Date(s.generatedAt).toLocaleTimeString() +
      (s.lastTs ? ' · last activity ' + timeAgo(s.lastTs) : '');
    document.getElementById('liveDot').classList.remove('stale');
  } catch (e) {
    document.getElementById('liveDot').classList.add('stale');
    document.getElementById('updated').textContent = 'error: ' + e.message;
  }
}

async function tickAdmin() {
  try {
    const r = await fetch('/api/admin');
    renderAdmin(await r.json());
  } catch (e) {
    renderAdmin({ configured: true, usage: { error: e.message }, cost: { error: e.message } });
  }
}

let usageTimer, adminTimer;
function start() {
  tickUsage(); tickAdmin();
  usageTimer = setInterval(tickUsage, POLL_USAGE_MS);
  adminTimer = setInterval(tickAdmin, POLL_ADMIN_MS);
}
function stop() { clearInterval(usageTimer); clearInterval(adminTimer); }

document.getElementById('autoToggle').addEventListener('change', (e) => {
  if (e.target.checked) start();
  else { stop(); document.getElementById('liveDot').classList.add('stale'); }
});

start();
