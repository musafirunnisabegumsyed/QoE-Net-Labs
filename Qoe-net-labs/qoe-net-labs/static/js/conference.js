/* Browser-side WebRTC: media capture, peer connection, 5 s getStats() sampling,
   resource allocation and outage injection. Flask only relays signaling. */
(() => {
  const S = {socket: null, pc: null, stream: null, sessionId: null, sid: null, iceServers: [],
             intervalMs: 5000, statsTimer: null, prev: null, pendingIce: [], outageActive: false,
             outageTimers: [], experiment: null, samples: 0, rating: null};
  const chart = new LineChart($('mosChart'), {min: 1, max: 5});

  const log = (msg) => { const d = document.createElement('div'); d.textContent = new Date().toLocaleTimeString() + '  ' + msg; $('log').prepend(d); };
  const setConn = (text, cls = '') => { const b = $('connBadge'); b.textContent = text; b.className = 'pill ' + cls; };
  const parseRes = (r) => { const [w, h] = r.split('x').map(Number); return {w, h}; };
  const alloc = () => ({...parseRes($('resolution').value), fps: +$('fps').value, kbps: +$('bitrate').value});

  // ---------- setup ----------
  (async function init() {
    const q = new URLSearchParams(location.search);
    if (q.get('room')) $('room').value = q.get('room');
    $('name').value = localStorage.getItem('qoe_name') || '';
    try {
      const cfg = await api('/config/ice');
      S.iceServers = cfg.iceServers; S.intervalMs = cfg.measurement_interval_s * 1000;
      const exps = (await api('/experiments')).items;
      exps.forEach((e) => { const o = document.createElement('option'); o.value = e.experiment_id; o.textContent = `${e.name} (${e.scenario})`; $('experiment').appendChild(o); });
      if (q.get('experiment')) { $('experiment').value = q.get('experiment'); onExperiment(); }
    } catch (e) { log('Setup error: ' + e.message); }
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = i; b.setAttribute('aria-pressed', 'false');
      b.onclick = () => { S.rating = i; [...$('rateButtons').children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
      $('rateButtons').appendChild(b);
    }
  })();

  async function onExperiment() {
    const id = $('experiment').value;
    S.experiment = null;
    if (!id) return;
    try {
      const e = await api('/experiments/' + id); S.experiment = e;
      const p = e.params;
      if (p.resolution) $('resolution').value = p.resolution;
      if (p.fps) $('fps').value = String(p.fps);
      if (p.max_bitrate_kbps) $('bitrate').value = p.max_bitrate_kbps;
      if (p.outage_duration_s) $('outageLen').value = p.outage_duration_s;
      log(`Experiment loaded: ${e.name}`);
    } catch (err) { log(err.message); }
  }
  $('experiment').addEventListener('change', onExperiment);

  // ---------- media ----------
  $('btnMedia').onclick = async () => {
    try {
      if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
      const {w, h, fps} = alloc();
      S.stream = await navigator.mediaDevices.getUserMedia({
        video: {width: {ideal: w}, height: {ideal: h}, frameRate: {ideal: fps}}, audio: true});
      $('localVideo').srcObject = S.stream;
      $('btnJoin').disabled = !!S.sessionId;
      const t = S.stream.getVideoTracks()[0].getSettings();
      log(`Camera ready: ${t.width}x${t.height} @ ${Math.round(t.frameRate || 0)} fps`);
    } catch (e) { log('Cannot access camera/microphone: ' + e.message); }
  };

  async function applyAllocation() {
    const {w, h, fps, kbps} = alloc();
    const vt = S.stream && S.stream.getVideoTracks()[0];
    if (vt) await vt.applyConstraints({width: {ideal: w}, height: {ideal: h}, frameRate: {ideal: fps}}).catch((e) => log('Constraint: ' + e.message));
    if (S.pc) {
      for (const s of S.pc.getSenders()) {
        if (!s.track || s.track.kind !== 'video') continue;
        const p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = kbps * 1000;
        p.encodings[0].maxFramerate = fps;
        try { await s.setParameters(p); } catch (e) { log('setParameters: ' + e.message); }
      }
    }
    log(`Allocation applied: ${w}x${h}, ${fps} fps, cap ${kbps} kbps`);
  }
  $('btnApply').onclick = applyAllocation;

  // ---------- session + signaling ----------
  $('btnJoin').onclick = async () => {
    const room = $('room').value.trim();
    if (!room) return log('Enter a room name.');
    const name = $('name').value.trim() || 'Participant';
    localStorage.setItem('qoe_name', name);
    try {
      const a = alloc();
      const s = await api('/sessions', {method: 'POST', body: {
        room, participant: name, experiment_id: $('experiment').value || null,
        config: {resolution: `${a.w}x${a.h}`, fps: a.fps, max_bitrate_kbps: a.kbps}}});
      S.sessionId = s.session_id;
    } catch (e) { return log('Could not create session: ' + e.message); }

    S.socket = io();
    S.socket.on('connect', () => S.socket.emit('join', {room, participant: name, session_id: S.sessionId}));
    S.socket.on('joined', (d) => { S.sid = d.sid; setConn('waiting for peer', 'warn'); log(`Joined room "${d.room}" (${d.peers.length} other peer)`); });
    S.socket.on('room-full', () => { log('Room already has two participants.'); cleanup(false); });
    S.socket.on('peer-joined', async (d) => { log(`Peer joined: ${d.participant || d.sid}`); await startOffer(); });
    S.socket.on('offer', onOffer);
    S.socket.on('answer', async (d) => { await S.pc.setRemoteDescription(d.sdp); await flushIce(); });
    S.socket.on('ice-candidate', async (d) => {
      if (S.pc && S.pc.remoteDescription) { try { await S.pc.addIceCandidate(d.candidate); } catch (e) { log('ICE: ' + e.message); } }
      else S.pendingIce.push(d.candidate);
    });
    S.socket.on('peer-left', () => { log('Peer left the room.'); closePeer(); setConn('waiting for peer', 'warn'); });
    $('btnJoin').disabled = true; $('btnLeave').disabled = false; $('btnOutage').disabled = false;
    $('ratingPanel').hidden = true;
    scheduleOutages();
  };

  function makePeer() {
    closePeer();
    const pc = new RTCPeerConnection({iceServers: S.iceServers});
    S.pc = pc;
    S.stream.getTracks().forEach((t) => pc.addTrack(t, S.stream));
    pc.onicecandidate = (e) => { if (e.candidate) S.socket.emit('ice-candidate', {candidate: e.candidate}); };
    pc.ontrack = (e) => { $('remoteVideo').srcObject = e.streams[0]; $('stageNote').classList.add('hidden'); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState; log('Connection state: ' + st);
      setConn(st, st === 'connected' ? 'ok' : (st === 'connecting' ? 'warn' : 'bad'));
      if (st === 'connected' && !S.statsTimer) startStats();
    };
    applyAllocation();
    return pc;
  }
  async function startOffer() {
    const pc = makePeer();
    await pc.setLocalDescription(await pc.createOffer());
    S.socket.emit('offer', {sdp: pc.localDescription});
  }
  async function onOffer(d) {
    const pc = makePeer();
    await pc.setRemoteDescription(d.sdp); await flushIce();
    await pc.setLocalDescription(await pc.createAnswer());
    S.socket.emit('answer', {sdp: pc.localDescription});
  }
  async function flushIce() {
    for (const c of S.pendingIce.splice(0)) { try { await S.pc.addIceCandidate(c); } catch (e) { log('ICE: ' + e.message); } }
  }
  function closePeer() {
    stopStats();
    if (S.pc) { S.pc.onconnectionstatechange = null; S.pc.close(); S.pc = null; }
    $('remoteVideo').srcObject = null; $('stageNote').classList.remove('hidden');
    $('stageNote').textContent = 'Waiting for the other participant to join.';
  }

  // ---------- stats collection (every 5 s) ----------
  async function snapshot() {
    const snap = {ts: performance.now(), inb: {}, out: {}, rin: {}, pair: {}};
    const report = await S.pc.getStats();
    let selectedId = null;
    report.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) selectedId = r.selectedCandidatePairId; });
    report.forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') snap.inb = r;
      else if (r.type === 'outbound-rtp' && r.kind === 'video') snap.out = r;
      else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') snap.rin = r;
      else if (r.type === 'candidate-pair' && (r.id === selectedId || (!selectedId && r.nominated && r.state === 'succeeded'))) snap.pair = r;
    });
    return snap;
  }
  const delta = (a, b, k) => (a[k] != null && b[k] != null) ? Math.max(0, a[k] - b[k]) : null;

  async function startStats() {
    try { S.prev = await snapshot(); } catch (e) { return log('getStats failed: ' + e.message); }
    S.statsTimer = setInterval(sample, S.intervalMs);
    log(`Collecting getStats() every ${S.intervalMs / 1000} s`);
  }
  function stopStats() { if (S.statsTimer) clearInterval(S.statsTimer); S.statsTimer = null; S.prev = null; }

  async function sample() {
    if (!S.pc || !S.sessionId || !S.prev) return;
    let cur;
    try { cur = await snapshot(); } catch (e) { return log('getStats failed: ' + e.message); }
    const prev = S.prev; S.prev = cur;
    const dt = (cur.ts - prev.ts) / 1000;
    const bytes = delta(cur.inb, prev.inb, 'bytesReceived');
    const sent = delta(cur.out, prev.out, 'bytesSent');
    const recvPk = delta(cur.inb, prev.inb, 'packetsReceived') || 0;
    const lostPk = delta({packetsLost: cur.inb.packetsLost}, {packetsLost: prev.inb.packetsLost}, 'packetsLost') || 0;
    const frames = delta(cur.inb, prev.inb, 'framesDecoded');
    const jbDelay = delta(cur.inb, prev.inb, 'jitterBufferDelay'), jbCount = delta(cur.inb, prev.inb, 'jitterBufferEmittedCount');
    const rttSec = cur.pair.currentRoundTripTime ?? cur.rin.roundTripTime;
    const payload = {
      window_s: dt,
      bitrate_kbps: bytes != null ? bytes * 8 / dt / 1000 : 0,
      send_bitrate_kbps: sent != null ? sent * 8 / dt / 1000 : 0,
      fps: frames != null ? frames / dt : (cur.inb.framesPerSecond || 0),
      frame_width: cur.inb.frameWidth || 0, frame_height: cur.inb.frameHeight || 0,
      packet_loss_pct: (recvPk + lostPk) > 0 ? lostPk / (recvPk + lostPk) * 100 : 0,
      jitter_ms: cur.inb.jitter != null ? cur.inb.jitter * 1000 : null,
      rtt_ms: rttSec != null ? rttSec * 1000 : null,
      jitter_buffer_delay_ms: (jbDelay != null && jbCount) ? jbDelay / jbCount * 1000 : null,
      freeze_count: delta(cur.inb, prev.inb, 'freezeCount') || 0,
      freeze_duration_s: delta(cur.inb, prev.inb, 'totalFreezesDuration') || 0,
      available_outgoing_kbps: cur.pair.availableOutgoingBitrate != null ? cur.pair.availableOutgoingBitrate / 1000 : null,
      quality_limitation: cur.out.qualityLimitationReason || null,
      connection_state: S.pc.connectionState, ice_state: S.pc.iceConnectionState,
      outage_injected_local: S.outageActive,
      target_width: alloc().w, target_height: alloc().h, target_fps: alloc().fps, target_bitrate_kbps: alloc().kbps,
    };
    try {
      const res = await api(`/sessions/${S.sessionId}/measurements`, {method: 'POST', body: payload});
      showSample(res.measurement, res.qoe);
    } catch (e) { log('Could not store measurement: ' + e.message); }
  }

  function showSample(m, qoe) {
    S.samples++;
    $('mos').textContent = qoe.mos.toFixed(2);
    const b = $('qoeClass'); b.textContent = qoe.classification; b.dataset.c = qoe.classification;
    $('sampleCount').textContent = `${S.samples} samples`;
    chart.push(qoe.mos);
    $('m_bitrate').textContent = fmt(m.bitrate_kbps, 0, ' kbps');
    $('m_fps').textContent = fmt(m.fps, 1, ' fps');
    $('m_res').textContent = m.frame_width ? `${m.frame_width}×${m.frame_height}` : '–';
    $('m_loss').textContent = fmt(m.packet_loss_pct, 2, ' %');
    $('m_jitter').textContent = fmt(m.jitter_ms, 1, ' ms');
    $('m_rtt').textContent = fmt(m.rtt_ms, 0, ' ms');
    $('m_freeze').textContent = `${m.freeze_count || 0} (${fmt(m.freeze_duration_s, 1, ' s')})`;
    $('m_send').textContent = fmt(m.send_bitrate_kbps, 0, ' kbps');
    $('m_limit').textContent = m.quality_limitation || '–';
  }

  // ---------- intermittent connectivity (sender pause) ----------
  async function setSending(active) {
    if (!S.pc) return;
    for (const s of S.pc.getSenders()) {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) continue;
      p.encodings.forEach((e) => { e.active = active; });
      try { await s.setParameters(p); } catch (e) { log('setParameters: ' + e.message); }
    }
  }
  async function injectOutage(seconds) {
    if (!S.pc || S.outageActive) return;
    S.outageActive = true; $('outageStatus').textContent = `Sending paused for ${seconds} s…`;
    log(`Outage injected: ${seconds} s`);
    await setSending(false);
    S.outageTimers.push(setTimeout(async () => {
      await setSending(true); S.outageActive = false; $('outageStatus').textContent = 'Sending resumed.'; log('Outage ended');
    }, seconds * 1000));
  }
  $('btnOutage').onclick = () => injectOutage(Math.max(1, +$('outageLen').value || 8));

  function scheduleOutages() {
    const p = S.experiment && S.experiment.params;
    if (!p || !p.outage_duration_s) return;
    const run = () => injectOutage(p.outage_duration_s);
    if (p.outage_interval_s > 0) {
      S.outageTimers.push(setTimeout(() => { run(); S.outageTimers.push(setInterval(run, (p.outage_interval_s + p.outage_duration_s) * 1000)); }, 20000));
    } else S.outageTimers.push(setTimeout(run, 20000));
    log(`Scheduled outages from experiment "${S.experiment.name}"`);
  }

  // ---------- leave + rating ----------
  async function cleanup(showRating) {
    S.outageTimers.forEach((t) => { clearTimeout(t); clearInterval(t); }); S.outageTimers = []; S.outageActive = false;
    closePeer();
    if (S.socket) { S.socket.emit('leave'); S.socket.disconnect(); S.socket = null; }
    let summary = null;
    if (S.sessionId) { try { summary = await api(`/sessions/${S.sessionId}/end`, {method: 'POST'}); } catch (e) { log(e.message); } }
    setConn('not connected'); $('btnLeave').disabled = true; $('btnOutage').disabled = true; $('btnJoin').disabled = !S.stream;
    if (showRating && summary) {
      $('ratingPanel').hidden = false; S.rating = null;
      [...$('rateButtons').children].forEach((x) => x.setAttribute('aria-pressed', 'false'));
      const s = summary.summary || {};
      $('rateResult').textContent = s.samples ? `Estimated mean QoE for this call: ${s.mean_mos} (${s.classification}) from ${s.samples} samples.` : 'No measurements were collected (the peer never connected).';
    } else { S.sessionId = null; }
    S.samples = 0;
  }
  $('btnLeave').onclick = () => cleanup(true);
  window.addEventListener('beforeunload', () => { if (S.sessionId) navigator.sendBeacon(`/api/sessions/${S.sessionId}/end`); });

  $('btnRate').onclick = async () => {
    if (!S.rating) return ($('rateResult').textContent = 'Pick a rating from 1 to 5.');
    try {
      await api(`/sessions/${S.sessionId}/rating`, {method: 'POST', body: {score: S.rating, comment: $('rateComment').value}});
      $('rateResult').textContent = 'Rating saved. Thank you.'; S.sessionId = null; $('rateComment').value = '';
    } catch (e) { $('rateResult').textContent = e.message; }
  };
})();
