/* UI wiring: routing, theme, conference controls, dashboard, charts, experiments, history, about. */
const VIEWS = ['home', 'conference', 'dashboard', 'experiments', 'history', 'about'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dlf = (n, t, m) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: m })); a.download = n; a.click(); };
const showErr = m => { const e = $('#err'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
const busy = (b, on, txt) => { b.disabled = on; if (on) { b.dataset.t = b.textContent; b.textContent = txt; } else if (b.dataset.t) b.textContent = b.dataset.t; };

function route() {
  let h = (location.hash || '#home').slice(1); if (!VIEWS.includes(h)) h = 'home';
  VIEWS.forEach(v => $('#' + v).classList.toggle('on', v === h));
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.hash === '#' + h));
  if (h === 'dashboard') { ensureCharts(); updateCharts(); }
  if (h === 'history') loadHistory();
  if (h === 'about') renderAbout();
}
addEventListener('hashchange', route);
document.querySelectorAll('#thm button').forEach(b => b.onclick = () => { document.documentElement.dataset.theme = b.dataset.t; document.querySelectorAll('#thm button').forEach(x => x.classList.toggle('on', x === b)); });

/* ---------- Home: academic details ---------- */
function acad() {
  let d = {}; try { d = JSON.parse(localStorage.getItem('acad') || '{}'); } catch (e) {}
  const rows = [['Project', 'Subjective & Objective QoE Framework for Video Conferencing with Intermittent Connectivity'], ['Type', 'Final-year CSE prototype (working demo + measurable data collection)'], ['Stack', 'HTML5 · CSS3 · Vanilla JS · WebRTC getStats() · FastAPI signaling · MongoDB history'], ['Course / Guide / Team', [d.c, d.g, d.t].filter(Boolean).join(' / ') || 'Edit on the About page for your report']];
  const t = $('#acad'); t.innerHTML = ''; rows.forEach(r => { const tr = t.insertRow(); tr.insertCell().textContent = r[0]; tr.insertCell().textContent = r[1]; tr.cells[0].style.color = '#94A3B8'; });
}
$('#a_s').onclick = () => { try { localStorage.setItem('acad', JSON.stringify({ g: $('#a_g').value, t: $('#a_t').value, c: $('#a_c').value })); } catch (e) {} acad(); };

/* ---------- Event log ---------- */
Bus.on('log', m => {
  const stamp = new Date().toLocaleTimeString() + '  ' + m + '\n';
  const l = $('#log'); if (l.dataset.e !== '1') { l.textContent = ''; l.dataset.e = '1'; } l.textContent += stamp; l.scrollTop = 1e9;
  const e = $('#evlog'); if (e.dataset.e !== '1') { e.textContent = ''; e.dataset.e = '1'; } e.textContent += stamp; e.scrollTop = 1e9;
});

/* ---------- Conference ---------- */
Bus.on('status', t => $('#st').textContent = t);
Bus.on('error', m => showErr(m));
Bus.on('peer', p => $('#wait').style.display = p ? 'none' : 'block');
Bus.on('remoteName', n => $('#rn').textContent = 'Remote — ' + n);
Bus.on('joined', () => { showErr(''); $('#lobby').style.display = 'none'; $('#call').style.display = 'block'; $('#ln').textContent = 'Local — ' + RTC.name; $('#wait').style.display = 'block'; });
Bus.on('left', () => { $('#lobby').style.display = 'block'; $('#call').style.display = 'none'; $('#st').textContent = 'not connected'; $('#rn').textContent = 'Remote'; ['#mic', '#cam'].forEach(s => { $(s).classList.remove('off'); }); $('#mic').textContent = 'Mic on'; $('#cam').textContent = 'Camera on'; $('#scr').textContent = 'Share screen'; });
Bus.on('leaving', () => { if (Monitor.on) Monitor.stop(); });
Bus.on('screenEnded', () => { RTC.toggleScreen().catch(() => {}); $('#scr').textContent = 'Share screen'; });
$('#join').onclick = async () => {
  const room = $('#room').value.trim(); if (!room) { showErr('Enter a Room ID to join.'); return; }
  showErr(''); busy($('#join'), true, 'Joining…');
  try { await RTC.join(room, $('#name').value.trim()); } catch (e) { showErr(e.message); RTC.leave(true); } finally { busy($('#join'), false); }
};
$('#leave').onclick = () => RTC.leave();
$('#mic').onclick = () => { const on = RTC.toggle('audio'); $('#mic').textContent = on ? 'Mic on' : 'Mic off'; $('#mic').classList.toggle('off', !on); };
$('#cam').onclick = () => { const on = RTC.toggle('video'); $('#cam').textContent = on ? 'Camera on' : 'Camera off'; $('#cam').classList.toggle('off', !on); };
$('#scr').onclick = async () => { try { $('#scr').textContent = (await RTC.toggleScreen()) ? 'Stop sharing' : 'Share screen'; } catch (e) { showErr('Screen share: ' + e.message); } };

/* ---------- Monitoring controls + consent ---------- */
function askMon() {
  if (Monitor.on) return;
  if (!RTC.pc) { $('#rec').textContent = 'Not in a call with a participant — join the conference and wait for the second participant, then press Start monitoring.'; return; }
  $('#dlg').showModal();
}
$('#mon').onclick = () => Monitor.on ? Monitor.stop() : askMon();
$('#dstart').onclick = askMon; $('#dstop').onclick = () => Monitor.on && Monitor.stop();
$('#no').onclick = () => $('#dlg').close();
$('#ok').onclick = async () => { $('#dlg').close(); try { await Monitor.start(); $('#sumbox').innerHTML = '<p class="note">Recording…</p>'; location.hash = '#dashboard'; } catch (e) { showErr('Could not start monitoring: ' + e.message); } };
const recLine = () => { const t = Monitor.on ? `recording — ${Monitor.samples.length} samples · session ${Monitor.sid}` : 'not recording — start monitoring during a call to collect real getStats() samples'; $('#rec').textContent = t; $('#cm_rec').textContent = Monitor.on ? `recording · ${Monitor.samples.length} samples` : 'not recording'; $('#mon').textContent = Monitor.on ? 'Stop monitoring' : 'Start monitoring'; };
Bus.on('mon', recLine);

/* ---------- Dashboard ---------- */
const INFO = { rtt: 'Round-trip time of the selected ICE candidate pair (currentRoundTripTime).', jit: 'Worst inbound RTP jitter among received streams (receiver-side).', loss: 'Δ packets lost / (Δ lost + Δ received) over the 5 s interval, inbound audio + video.', in: 'Δ bytes received × 8 / Δ time.', out: 'Δ bytes sent × 8 / Δ time.', ain: 'Inbound audio bytes per interval.', vin: 'Inbound video bytes per interval.', fps: 'Decoded frames per second (framesPerSecond).', drop: 'Frames dropped by the decoder this interval.', frz: 'Freeze events this interval (freezeCount delta).', bw: 'Congestion-controller ESTIMATE of outgoing bandwidth (availableOutgoingBitrate, Chromium only). Not a direct measurement.' };
const TILES = [['rtt', 'Round-trip time', 'ms', 'rtt_ms'], ['jit', 'Jitter', 'ms', 'jitter_ms'], ['loss', 'Packet loss', '%', 'packet_loss_pct'], ['in', 'Incoming bitrate', 'kbps', 'incoming_bitrate_kbps'], ['out', 'Outgoing bitrate', 'kbps', 'outgoing_bitrate_kbps'], ['ain', 'Audio bitrate', 'kbps', 'audio_bitrate_kbps'], ['vin', 'Video bitrate', 'kbps', 'video_bitrate_kbps'], ['fps', 'Frame rate', 'fps', 'frames_per_second'], ['drop', 'Dropped frames', 'frames', 'frames_dropped'], ['frz', 'Video freezes', 'count', 'freeze_count'], ['bw', 'Available bandwidth (estimate)', 'kbps', 'available_bandwidth_kbps']];
function initDash() {
  $('#tiles').innerHTML = TILES.map(t => `<div class="card"><div class="k">${t[1]} <span class="i" title="${esc(INFO[t[0]])}">i</span></div><div><span class="v" id="t_${t[0]}">—</span><span class="u">${t[2]}</span></div></div>`).join('');
  $('#mini').innerHTML = [['rtt', 'RTT'], ['jit', 'Jitter'], ['loss', 'Packet loss'], ['fps', 'FPS']].map(t => `<div class="card"><div class="k">${t[1]}</div><div class="v" id="s_${t[0]}">—</div></div>`).join('');
}
const pv = (r, k) => r[k] == null ? '—' : r[k];
Bus.on('sample', ({ row: r, net }) => {
  $('#nodata').style.display = 'none'; recLine();
  TILES.forEach(t => $('#t_' + t[0]).textContent = pv(r, t[3]));
  ['rtt', 'jit', 'loss', 'fps'].forEach(k => $('#s_' + k).textContent = pv(r, TILES.find(t => t[0] === k)[3]));
  const c = $('#cond'); c.textContent = r.network_condition; c.className = 'pill ' + r.network_condition; c.style.background = '';
  $('#qv').textContent = pv(r, 'overall_quality_score'); $('#ql').textContent = (r.qoe_class ? r.qoe_class + ' · ' : '') + QoE.label(r.overall_quality_score);
  $('#why').textContent = net.why + ' (Prototype category, not a universal standard.)';
  $('#cm_rtt').textContent = pv(r, 'rtt_ms'); $('#cm_jit').textContent = pv(r, 'jitter_ms'); $('#cm_loss').textContent = pv(r, 'packet_loss_pct'); $('#cm_qoe').textContent = pv(r, 'overall_quality_score');
  const cc = $('#cm_cond'); cc.textContent = r.network_condition; cc.className = 'pill ' + r.network_condition; cc.style.background = '';
  updateCharts();
});
function paintPrio() {
  const none = !RTC.pc;
  $('#p1').textContent = none ? 'not in call' : 'protected · never throttled';
  $('#p2').textContent = none ? 'not in call' : (Monitor.enc.cam || 'default encoding');
  $('#p3').textContent = none ? 'not in call' : (RTC.screenSender ? (Monitor.enc.screen || 'full quality') : 'not sharing');
  $('#preason').textContent = Monitor.reason ? 'Last decision reason: ' + Monitor.reason : 'No priority decision yet.';
}
Bus.on('prio', paintPrio); Bus.on('conn', paintPrio); Bus.on('joined', paintPrio); Bus.on('left', paintPrio);
$('#pm').querySelectorAll('button').forEach(b => b.onclick = () => { Monitor.auto = b.dataset.m === '1'; $('#pm').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); Bus.emit('log', 'Priority mode: ' + (Monitor.auto ? 'Auto' : 'Manual')); });
$('#apply').onclick = () => { if (!RTC.pc) return Bus.emit('log', 'Apply now ignored — not in a call'); Monitor.applyPolicy(Monitor.cond, Monitor.reason || 'manual apply'); };

/* Charts (Chart.js) */
const CH = {};
const CHART_DEFS = { c_qoe: [['overall_quality_score', '#22B8D6', 'Estimated QoE']], c_rtt: [['rtt_ms', '#22B8D6', 'RTT ms'], ['jitter_ms', '#FBBF24', 'Jitter ms']], c_loss: [['packet_loss_pct', '#F87171', 'Loss %']], c_br: [['incoming_bitrate_kbps', '#34D399', 'Incoming kbps'], ['outgoing_bitrate_kbps', '#A78BFA', 'Outgoing kbps']], c_fps: [['frames_per_second', '#F87171', 'FPS'], ['frames_dropped', '#FBBF24', 'Dropped frames']] };
function ensureCharts() {
  if (typeof Chart === 'undefined') return;
  Object.keys(CHART_DEFS).forEach(id => {
    if (CH[id]) return;
    CH[id] = new Chart($('#' + id), { type: 'line', data: { labels: [], datasets: CHART_DEFS[id].map(s => ({ label: s[2], borderColor: s[1], backgroundColor: s[1], data: [], tension: .2, pointRadius: 3, spanGaps: false })) },
      options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'sample #', color: '#94A3B8' }, ticks: { color: '#94A3B8' } }, y: { ticks: { color: '#94A3B8' }, ...(id === 'c_qoe' ? { min: 1, max: 5 } : { beginAtZero: true }) } }, plugins: { legend: { labels: { color: '#94A3B8' } } } } });
  });
}
function updateCharts() {
  const S = Monitor.samples;
  Object.keys(CH).forEach(id => { const c = CH[id]; c.data.labels = S.map(r => r.sample_num); CHART_DEFS[id].forEach((s, i) => c.data.datasets[i].data = S.map(r => r[s[0]])); c.update('none'); });
}

/* Exports + summary */
const sid = () => Monitor.sid || 'session';
$('#csv').onclick = () => {
  if (!Monitor.samples.length) { Bus.emit('log', 'Nothing to export: no samples collected yet.'); return; }
  const r = toCsv(Monitor.samples); dlf(sid() + '.csv', r.text, 'text/csv');
  Bus.emit('log', `CSV exported: ${r.exported} valid rows${r.rejected.length ? ', ' + r.rejected.length + ' rejected by validation' : ''}`);
};
const curSummary = () => Monitor.samples.length ? (Monitor.on ? Monitor.summary() : (Monitor.lastSummary || Monitor.summary())) : null;
$('#sumj').onclick = () => { const s = curSummary(); if (s) dlf(sid() + '-summary.json', JSON.stringify({ ...s, experiment_log: ExpLog }, null, 2), 'application/json'); };
$('#sumt').onclick = () => { const s = curSummary(); if (s) dlf(sid() + '-summary.txt', Monitor.summaryText(s), 'text/plain'); };
Bus.on('summary', s => { $('#sumbox').innerHTML = s ? '<pre class="logbox" style="max-height:none">' + esc(Monitor.summaryText(s)) + '</pre>' : '<p class="note">No samples were collected.</p>'; });
$('#clrd').onclick = () => {
  if (Monitor.on) return Bus.emit('log', 'Stop monitoring before clearing data.');
  Monitor.samples = []; Monitor.lastSummary = null; Monitor.recs = []; Monitor.pchg = 0; initDash(); updateCharts(); $('#nodata').style.display = '';
  $('#cond').textContent = '—'; $('#cond').className = 'pill'; $('#qv').textContent = '—'; $('#ql').textContent = 'no data'; recLine();
  $('#sumbox').innerHTML = '<p class="note">Summary appears here when you stop monitoring (or end the call). It includes duration, sample count, averages, interruptions, recovery time, priority changes and a Normal-vs-Degraded comparison.</p>';
};

/* ---------- Experiments ---------- */
const SCENARIOS = ['Normal connectivity', 'High latency', 'High jitter', 'Packet loss', 'Restricted bandwidth', 'Temporary connection interruption', 'Recovery after interruption'];
SCENARIOS.forEach(s => { const b = document.createElement('button'); b.className = 'btn s'; b.textContent = s; b.onclick = () => { Monitor.scenario = s; $('#curs').textContent = s; document.querySelectorAll('#scn button').forEach(x => x.classList.toggle('on', x === b)); }; $('#scn').appendChild(b); });
const METH = { external: 'external network tool', physical: 'physical action', simulated: 'simulated in browser' };
function renderExpLog() {
  $('#xlog').innerHTML = '<tr><th>Time</th><th>Scenario</th><th>Method</th><th>Note</th><th>Sample #</th></tr>' + (ExpLog.length ? ExpLog.map(e => `<tr><td>${esc(new Date(e.at).toLocaleTimeString())}</td><td>${esc(e.scenario)}</td><td>${esc(METH[e.method])}</td><td>${esc(e.note)}</td><td>${e.sample_num ?? ''}</td></tr>`).join('') : '<tr><td colspan="5" class="note">No markers yet.</td></tr>');
}
$('#addm').onclick = () => { const e = { at: new Date().toISOString(), scenario: Monitor.scenario, method: $('#meth').value, note: $('#xnote').value.trim(), sample_num: Monitor.on ? Monitor.n : null }; ExpLog.push(e); $('#xnote').value = ''; renderExpLog(); Bus.emit('log', `Experiment marker: ${e.scenario} (${METH[e.method]})${e.note ? ' — ' + e.note : ''}`); };
$('#xcsv').onclick = () => { if (!ExpLog.length) return; const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; dlf('experiment_log.csv', 'timestamp,scenario,method,note,sample_num\n' + ExpLog.map(e => [e.at, e.scenario, METH[e.method], e.note, e.sample_num ?? ''].map(q).join(',')).join('\n') + '\n', 'text/csv'); };
$('#xclr').onclick = () => { ExpLog.length = 0; renderExpLog(); };
let capOn = false;
$('#cap').onclick = async () => { try { await Monitor.simulateCap(!capOn); capOn = !capOn; $('#cap').textContent = capOn ? 'Remove sender cap' : 'Enable sender cap (simulated)'; $('#meth').value = 'simulated'; } catch (e) { Bus.emit('log', 'Sender cap failed: ' + e.message); } };

/* ---------- History ---------- */
async function loadHistory() {
  let d = [], err = '';
  try { const r = await fetch('/api/sessions'); if (!r.ok) throw new Error('HTTP ' + r.status); d = await r.json(); } catch (e) { err = 'Could not load history: ' + e.message; }
  $('#ht').innerHTML = '<tr><th>Session</th><th>Room</th><th>Started</th><th>Duration</th><th>Samples</th><th>Avg RTT</th><th>Avg loss %</th><th>Avg est. QoE</th><th></th></tr>' +
    (err ? `<tr><td colspan="9" class="warn">${esc(err)}</td></tr>` : d.length ? d.map(s => `<tr><td>${esc(s._id)}</td><td>${esc(s.room)}</td><td>${esc(s.started)}</td><td>${s.duration_s ?? ''} s</td><td>${s.samples_n}</td><td>${s.avg_rtt_ms ?? ''}</td><td>${s.avg_loss_pct ?? ''}</td><td>${s.avg_qoe_overall ?? ''}</td><td><a href="#history" class="hc" data-id="${esc(s._id)}">CSV</a> · <a href="#history" class="hd" data-id="${esc(s._id)}">Delete</a></td></tr>`).join('') : '<tr><td colspan="9" class="note">No saved sessions yet. Stop a monitoring session to save one.</td></tr>');
  document.querySelectorAll('.hc').forEach(a => a.onclick = async e => { e.preventDefault(); const s = await (await fetch('/api/sessions/' + a.dataset.id)).json(); dlf(s._id + '.csv', toCsv(s.samples).text, 'text/csv'); });
  document.querySelectorAll('.hd').forEach(a => a.onclick = async e => { e.preventDefault(); await fetch('/api/sessions/' + a.dataset.id, { method: 'DELETE' }); loadHistory(); });
}
$('#hrefresh').onclick = loadHistory;

/* ---------- About ---------- */
function renderAbout() {
  $('#cfg').textContent = JSON.stringify({ sampleMs: CONFIG.sampleMs, thresholds: CONFIG.thresholds, qoe: CONFIG.qoe, policy: CONFIG.policy }, null, 1);
  const t = { RTCPeerConnection: typeof RTCPeerConnection !== 'undefined', getStats: typeof RTCPeerConnection !== 'undefined' && !!RTCPeerConnection.prototype.getStats, setParameters: typeof RTCRtpSender !== 'undefined' && !!RTCRtpSender.prototype.setParameters, getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia), secureContext: window.isSecureContext, chartJs: typeof Chart !== 'undefined', mlModelIntegrated: !!QoE.predictor };
  $('#binfo').textContent = navigator.userAgent + '\n' + JSON.stringify(t, null, 1) + '\nMetric availability is checked per session; see "unavailable_metrics" in the exported summary.';
}

initDash(); paintPrio(); renderExpLog(); recLine(); acad(); route();
