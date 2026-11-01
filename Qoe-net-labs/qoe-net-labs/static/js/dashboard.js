(() => {
  const chart = new LineChart($('liveChart'), {min: 1, max: 5});
  const live = {};            // session_id -> {label, values}
  let current = '';

  function stat(label, value) { return `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`; }

  async function load() {
    const d = await api('/dashboard/summary');
    $('statCards').innerHTML =
      stat('Sessions', d.total_sessions) + stat('Active now', d.active_sessions) + stat('Measurements', d.total_measurements) +
      stat('Mean estimated MOS', fmt(d.mean_mos, 2)) + stat('Mean participant rating', fmt(d.mean_subjective, 2)) +
      stat('Estimate vs rating (Pearson r)', d.objective_vs_subjective_pearson ?? 'needs ≥3 rated');
    const total = Object.values(d.class_distribution).reduce((a, b) => a + b, 0) || 1;
    $('dist').innerHTML = Object.entries(d.class_distribution).map(([c, n]) =>
      `<div class="bar"><span>${classBadge(c)}</span><i style="width:${n / total * 100}%;background:${CLASS_COLORS[c]}"></i><span>${n}</span></div>`).join('');
    const a = d.averages;
    $('avgs').innerHTML = [['Bitrate', fmt(a.bitrate, 0, ' kbps')], ['Frame rate', fmt(a.fps, 1, ' fps')], ['Loss', fmt(a.loss, 2, ' %')],
      ['Jitter', fmt(a.jitter, 1, ' ms')], ['RTT', fmt(a.rtt, 0, ' ms')]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const tb = document.querySelector('#recent tbody');
    tb.innerHTML = d.recent_sessions.length ? d.recent_sessions.map((s) => `<tr>
      <td>${fmtTime(s.started_at)}</td><td>${esc(s.room)}</td><td>${esc(s.participant)}</td><td>${esc(s.status)}</td>
      <td>${fmt(s.summary?.mean_mos, 2)}</td><td>${classBadge(s.summary?.classification)}</td>
      <td>${s.rating ? s.rating.score : '–'}</td><td><a href="/history?session=${s.session_id}">Open</a></td></tr>`).join('')
      : '<tr><td class="empty" colspan="8">No sessions yet. Start a conference to collect data.</td></tr>';
    document.querySelector('#sig tbody').innerHTML = d.recent_signaling.length ? d.recent_signaling.map((e) =>
      `<tr><td>${fmtTime(e.ts)}</td><td>${esc(e.event)}</td><td>${esc(e.room)}</td></tr>`).join('')
      : '<tr><td class="empty" colspan="3">No signaling events yet.</td></tr>';
  }

  function render() {
    const s = live[current];
    chart.set(s ? s.values : []);
    if (s) $('liveLatest').textContent = `${s.label}: latest ${s.last}`;
  }
  $('liveSession').onchange = (e) => { current = e.target.value; render(); };

  const socket = io();
  socket.on('connect', () => socket.emit('dashboard:subscribe'));
  socket.on('qoe:update', (m) => {
    const id = m.session_id;
    if (!live[id]) {
      live[id] = {label: `${m.participant} · ${id}`, values: [], last: ''};
      const sel = $('liveSession');
      if (sel.options[0] && sel.options[0].value === '') sel.remove(0);
      const o = document.createElement('option'); o.value = id; o.textContent = live[id].label; sel.appendChild(o);
      if (!current) { current = id; sel.value = id; }
    }
    live[id].values.push(m.qoe_mos); if (live[id].values.length > 60) live[id].values.shift();
    live[id].last = `MOS ${m.qoe_mos.toFixed(2)} (${m.qoe_class}), ${fmt(m.bitrate_kbps, 0)} kbps, ${fmt(m.fps, 0)} fps, RTT ${fmt(m.rtt_ms, 0)} ms`;
    if (id === current) render();
    load();
  });
  load(); render();
})();
