(() => {
  async function load() {
    const d = await api('/experiments');
    if (!$('scenario').options.length) {
      d.scenarios.forEach((s) => { const o = document.createElement('option'); o.value = s; o.textContent = s.replace(/_/g, ' '); $('scenario').appendChild(o); });
    }
    const tb = document.querySelector('#expTable tbody');
    tb.innerHTML = d.items.length ? d.items.map((e) => {
      const p = e.params;
      const outage = p.outage_duration_s ? `, outage ${p.outage_duration_s}s${p.outage_interval_s ? ' every ' + p.outage_interval_s + 's' : ' once'}` : '';
      return `<tr>
        <td><strong>${esc(e.name)}</strong><br><span class="muted">${esc(e.description)}</span></td>
        <td>${esc(e.scenario.replace(/_/g, ' '))}</td>
        <td>${esc(p.resolution)} @ ${p.fps} fps, ${p.max_bitrate_kbps} kbps${outage}</td>
        <td>${e.stats.sessions}</td><td>${fmt(e.stats.mean_mos, 2)}</td><td>${fmt(e.stats.mean_subjective, 2)}</td>
        <td><a class="btn small primary" href="/conference?experiment=${e.experiment_id}">Run</a>
            <a class="btn small" href="/api/export/sessions.csv?experiment_id=${e.experiment_id}">CSV</a>
            <button class="btn small danger" data-del="${e.experiment_id}">Delete</button></td></tr>`;
    }).join('') : '<tr><td class="empty" colspan="7">No experiments yet. Create one with the form.</td></tr>';
  }

  document.addEventListener('click', async (ev) => {
    const id = ev.target.dataset && ev.target.dataset.del;
    if (id && confirm('Delete this experiment? Its sessions are kept but detached.')) { await api('/experiments/' + id, {method: 'DELETE'}); load(); }
  });

  $('expForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await api('/experiments', {method: 'POST', body: {
        name: f.get('name'), scenario: f.get('scenario'), description: f.get('description'),
        params: {resolution: f.get('resolution'), fps: +f.get('fps'), max_bitrate_kbps: +f.get('max_bitrate_kbps'),
                 outage_duration_s: +f.get('outage_duration_s'), outage_interval_s: +f.get('outage_interval_s')}}});
      $('expMsg').textContent = 'Experiment saved.'; ev.target.reset(); load();
    } catch (e) { $('expMsg').textContent = e.message; }
  });
  load();
})();
