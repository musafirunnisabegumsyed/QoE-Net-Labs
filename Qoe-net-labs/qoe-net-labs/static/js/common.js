/* Shared helpers: API client, formatting, tiny canvas line chart. */
const $ = (id) => document.getElementById(id);
const CLASS_COLORS = {Excellent:'#4ADE80', Good:'#A3E635', Fair:'#FACC15', Poor:'#FB923C', Bad:'#F87171'};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 1, unit = '') => (v === null || v === undefined || Number.isNaN(v)) ? '–' : Number(v).toFixed(d) + unit;
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString() : '–';
const fmtClock = (iso) => iso ? new Date(iso).toLocaleTimeString() : '–';

async function api(path, opts = {}) {
  const init = {method: opts.method || 'GET', headers: {}};
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function classBadge(c) {
  if (!c) return '<span class="muted">–</span>';
  return `<span class="dot" style="background:${CLASS_COLORS[c] || '#888'}"></span>${esc(c)}`;
}

class LineChart {
  constructor(canvas, {min = null, max = null, color = '#5CB8FF', bands = false} = {}) {
    this.canvas = canvas; this.opts = {min, max, color, bands}; this.values = [];
    window.addEventListener('resize', () => this.draw());
  }
  set(values) { this.values = values.filter((v) => v !== null && v !== undefined); this.draw(); }
  push(v, limit = 60) { this.values.push(v); if (this.values.length > limit) this.values.shift(); this.draw(); }
  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = parseInt(c.getAttribute('height'), 10) || 150;
    c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const pad = {l: 34, r: 10, t: 8, b: 14};
    const vals = this.values;
    let lo = this.opts.min ?? Math.min(0, ...vals), hi = this.opts.max ?? Math.max(1, ...vals);
    if (hi === lo) hi = lo + 1;
    const X = (i) => pad.l + (vals.length < 2 ? 0 : i * (w - pad.l - pad.r) / (vals.length - 1));
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    g.font = '11px sans-serif'; g.fillStyle = '#8C99AE'; g.strokeStyle = '#243044'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, y = Y(v);
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
      g.fillText(Math.abs(hi - lo) >= 10 ? Math.round(v) : v.toFixed(1), 2, y + 4);
    }
    if (!vals.length) { g.fillText('No samples yet', pad.l + 8, h / 2); return; }
    g.strokeStyle = this.opts.color; g.lineWidth = 2; g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    g.fillStyle = this.opts.color;
    vals.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), 2.5, 0, 6.3); g.fill(); });
  }
}
