(() => {
  const PAGE = 15; let skip = 0, total = 0;
  const charts = {mos: new LineChart($('cMos'), {min: 1, max: 5}), bit: new LineChart($('cBit'), {min: 0, color: '#4ADE80'}), rtt: new LineChart($('cRtt'), {min: 0, color: '#FACC15'})};

  function query() {
    const f = new FormData($('filters')); const p = new URLSearchParams({limit: PAGE, skip});
    for (const [k, v] of f.entries()) if (v) p.set(k, v);
    return p.toString();
  }
  async function load() {
    const d = await api('/sessions?' + query()); total = d.total;
    document.querySelector('#sessions tbody').innerHTML = d.items.length ? d.items.map((s) => `<tr>
      <td>${fmtTime(s.started_at)}</td><td>${esc(s.room)}</td><td>${esc(s.participant)}</td>
      <td>${s.summary?.samples ?? 0}</td><td>${fmt(s.summary?.mean_mos, 2)}</td><td>${classBadge(s.summary?.classification)}</td>
      <td>${s.rating ? s.rating.score : '–'}</td>
      <td><button class="btn small" data-open="${s.session_id}">Details</button>
          <button class="btn small danger" data-del="${s.session_id}">Delete</button></td></tr>`).join('')
      : '<tr><td class="empty" colspan="8">No sessions match.</td></tr>';
    $('pageInfo').textContent = total ? `${skip + 1}–${Math.min(skip + PAGE, total)} of ${total}` : '0 sessions';
    $('prev').disabled = skip === 0; $('next').disabled = skip + PAGE >= total;
  }

  async function openSession(id) {
    const [s, m] = await Promise.all([api('/sessions/' + id), api(`/sessions/${id}/measurements`)]);
    const rows = m.items;
    $('detail').hidden = false;
    $('dTitle').textContent = `Session ${id}`;
    const sm = s.summary || {};
    $('dMeta').textContent = `${s.participant} in room "${s.room}" · ${fmtTime(s.started_at)} · ${s.status}` +
      (sm.samples ? ` · mean MOS ${sm.mean_mos} (${sm.classification}), ${sm.outage_samples} outage windows` : '') +
      (s.rating ? ` · rated ${s.rating.score}/5${s.rating.comment ? ': ' + s.rating.comment : ''}` : '');
    $('dExports').innerHTML = ['csv', 'json'].map((f) => `<a class="btn small" href="/api/export/session/${id}.${f}">${f.toUpperCase()}</a>`).join('');
    charts.mos.set(rows.map((r) => r.qoe_mos)); charts.bit.set(rows.map((r) => r.bitrate_kbps)); charts.rtt.set(rows.map((r) => r.rtt_ms));
    document.querySelector('#mTable tbody').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td>${r.seq}</td><td>${fmtClock(r.ts)}</td><td>${fmt(r.qoe_mos, 2)}</td><td>${classBadge(r.qoe_class)}</td>
      <td>${fmt(r.bitrate_kbps, 0)}</td><td>${fmt(r.fps, 1)}</td><td>${r.frame_width ? r.frame_width + '×' + r.frame_height : '–'}</td>
      <td>${fmt(r.packet_loss_pct, 2)}</td><td>${fmt(r.jitter_ms, 1)}</td><td>${fmt(r.rtt_ms, 0)}</td><td>${r.freeze_count ?? 0}</td></tr>`).join('')
      : '<tr><td class="empty" colspan="11">No measurements stored for this session.</td></tr>';
    $('detail').scrollIntoView({behavior: 'smooth'});
  }

  document.addEventListener('click', async (ev) => {
    const d = ev.target.dataset || {};
    if (d.open) openSession(d.open);
    if (d.del && confirm('Delete this session and its measurements?')) { await api('/sessions/' + d.del, {method: 'DELETE'}); $('detail').hidden = true; load(); }
  });
  $('filters').addEventListener('submit', (e) => { e.preventDefault(); skip = 0; load(); });
  $('prev').onclick = () => { skip = Math.max(0, skip - PAGE); load(); };
  $('next').onclick = () => { skip += PAGE; load(); };

  (async () => {
    (await api('/experiments')).items.forEach((e) => { const o = document.createElement('option'); o.value = e.experiment_id; o.textContent = e.name; $('fExp').appendChild(o); });
    await load();
    const id = new URLSearchParams(location.search).get('session');
    if (id) openSession(id).catch(() => {});
  })();
})();
