/* getStats() sampler (every 5 s), QoE estimate, network classification, priority policy, summary, CSV. */
const ExpLog = [];   // manual experiment markers {at, scenario, method, note}
const R = (v, d = 1) => v == null || !isFinite(v) ? null : +v.toFixed(d);
const sumOf = (arr, f) => { const x = arr.map(f).filter(v => typeof v === 'number'); return x.length ? x.reduce((a, b) => a + b, 0) : null; };

const Monitor = {
  on: false, samples: [], prev: {}, prevT: 0, sid: '', t0: 0, n: 0, tmr: null, busy: false, intr: 0, recs: [], cond: 'Normal',
  pchg: 0, auto: true, enc: { cam: '', screen: '' }, reason: '', lastSummary: null, scenario: 'Normal connectivity',

  delta(k, v) { const p = this.prev[k]; this.prev[k] = v; return v == null || p == null || v < p ? null : v - p; },

  async collect() {
    const rep = await RTC.pc.getStats(); let sel = null;
    rep.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) sel = r.selectedCandidatePairId; });
    const o = { pair: null, aIn: [], vIn: [], out: [] };
    rep.forEach(r => {
      if (r.type === 'candidate-pair' && (sel ? r.id === sel : r.nominated && r.state === 'succeeded')) o.pair = r;
      else if (r.type === 'inbound-rtp') (r.kind === 'audio' ? o.aIn : o.vIn).push(r);
      else if (r.type === 'outbound-rtp') o.out.push(r);
    });
    return o;
  },

  async start() {
    this.samples = []; this.prev = {}; this.n = 0; this.recs = []; this.intr = 0; this.pchg = 0; this.cond = 'Normal'; this.reason = '';
    this.sid = 's' + Date.now().toString(36); this.t0 = Date.now(); this.lastSummary = null;
    await this.collect().then(o => this.derive(o, true));          // baseline so the first sample has valid deltas
    this.on = true; this.prevT = performance.now();
    this.tmr = setInterval(() => this.tick(), CONFIG.sampleMs);
    Bus.emit('log', 'Monitoring started · session ' + this.sid); Bus.emit('mon', true);
  },

  async tick() {
    if (this.busy || !this.on) return;                              // never sample the same interval twice
    if (!RTC.pc) { Bus.emit('log', 'No active peer connection — sample skipped (nothing recorded).'); return; }
    this.busy = true;
    try { await this.sample(); } catch (e) { Bus.emit('log', 'Sample error: ' + e.message); } finally { this.busy = false; }
  },

  derive(o, baseline) {
    const now = performance.now(), dt = baseline ? 1 : (now - this.prevT) / 1000; if (!baseline) this.prevT = now;
    const rate = (k, bytes) => { const d = this.delta(k, bytes); return d == null ? null : d * 8 / dt / 1000; };
    const aB = sumOf(o.aIn, r => r.bytesReceived), vB = sumOf(o.vIn, r => r.bytesReceived);
    const inB = aB == null && vB == null ? null : (aB || 0) + (vB || 0);
    const lostA = sumOf(o.aIn, r => r.packetsLost), recvA = sumOf(o.aIn, r => r.packetsReceived);
    const lostV = sumOf(o.vIn, r => r.packetsLost), recvV = sumOf(o.vIn, r => r.packetsReceived);
    const lossPct = (k, l, p) => { const dl = this.delta(k + 'L', l), dp = this.delta(k + 'P', p); return dl == null || dp == null || dl + dp === 0 ? null : dl / (dl + dp) * 100; };
    const jit = [...o.aIn, ...o.vIn].map(r => r.jitter).filter(v => typeof v === 'number');
    const fpsL = o.vIn.map(r => r.framesPerSecond).filter(v => typeof v === 'number');
    const cnt = (k, f) => this.delta(k, sumOf(o.vIn, f));
    const d = {
      rtt: o.pair && o.pair.currentRoundTripTime != null ? o.pair.currentRoundTripTime * 1000 : null,
      avail: o.pair && o.pair.availableOutgoingBitrate != null ? o.pair.availableOutgoingBitrate / 1000 : null,
      jitter: jit.length ? Math.max(...jit) * 1000 : null,
      inKbps: rate('in', inB), outKbps: rate('out', sumOf(o.out, r => r.bytesSent)),
      audioKbps: rate('aB', aB), videoKbps: rate('vB', vB),
      loss: lossPct('t', (lostA == null && lostV == null) ? null : (lostA || 0) + (lostV || 0), (recvA == null && recvV == null) ? null : (recvA || 0) + (recvV || 0)),
      audioLoss: lossPct('a', lostA, recvA), videoLoss: lossPct('v', lostV, recvV),
      fps: fpsL.length ? Math.max(...fpsL) : null,
      dropped: cnt('drop', r => r.framesDropped), freezes: cnt('frz', r => r.freezeCount),
      freezeMs: (x => x == null ? null : x * 1000)(cnt('frzD', r => r.totalFreezesDuration)),
      concealment: this.delta('conc', sumOf(o.aIn, r => r.concealmentEvents)),
      dt, hasVideo: o.vIn.length > 0
    };
    return d;
  },

  async sample() {
    const d = this.derive(await this.collect(), false);
    let recoveryMs = null;
    if (d.inKbps === 0) this.intr += d.dt;
    else if (d.inKbps != null && this.intr > 0) { recoveryMs = Math.round(this.intr * 1000); this.recs.push(this.intr); }
    const intrNow = Math.round(this.intr * 10) / 10;
    if (d.inKbps != null && d.inKbps > 0) this.intr = 0;
    const conn = RTC.pc.connectionState;
    const net = QoE.classify({ rtt: d.rtt, jitter: d.jitter, loss: d.loss, interruption: intrNow, conn });
    const q = QoE.estimate({ ...d, interruption: intrNow });
    this.n++;
    const row = {
      video_id: this.sid + '-main', timestamp: new Date().toISOString(), session_id: this.sid, sample_num: this.n,
      rtt_ms: R(d.rtt), jitter_ms: R(d.jitter), packet_loss_pct: R(d.loss, 2), available_bandwidth_kbps: R(d.avail),
      incoming_bitrate_kbps: R(d.inKbps), outgoing_bitrate_kbps: R(d.outKbps), audio_bitrate_kbps: R(d.audioKbps),
      audio_packet_loss_pct: R(d.audioLoss, 2), video_bitrate_kbps: R(d.videoKbps), video_packet_loss_pct: R(d.videoLoss, 2),
      frames_per_second: R(d.fps), frames_dropped: d.dropped, freeze_count: d.freezes, freeze_duration_ms: R(d.freezeMs, 0),
      audio_concealment_events: d.concealment, network_condition: net.cls, connectivity_status: intrNow > 0 ? 'interrupted' : conn,
      interruption_duration_s: intrNow, recovery_time_ms: recoveryMs,
      stream_type: !d.hasVideo ? 'audio_only' : RTC.screen ? 'camera+screen' : 'camera',
      audio_quality_score: R(q.audio, 2), video_quality_score: R(q.video, 2), overall_quality_score: R(q.overall, 2), qoe_class: QoE.qoeClass(R(q.overall, 2))
    };
    const errs = validateRow(row);
    if (errs.length) { Bus.emit('log', 'Sample ' + row.sample_num + ' failed validation: ' + errs.join('; ')); }
    this.samples.push(row); this.net = net;
    Bus.emit('sample', { row, net });
    if (net.cls !== this.cond) { Bus.emit('log', `Condition: ${this.cond} → ${net.cls}. ${net.why}`); this.cond = net.cls; this.reason = net.why; if (this.auto) this.applyPolicy(net.cls, net.why); }
  },

  async setEnc(sender, o) {
    try { const p = sender.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; Object.assign(p.encodings[0], o); await sender.setParameters(p); return true; }
    catch (e) { Bus.emit('log', 'setParameters failed: ' + e.message); return false; }
  },

  async applyPolicy(cls, why) {
    if (!RTC.pc) { Bus.emit('log', 'Policy not applied: no peer connection.'); return; }
    const P = CONFIG.policy[cls], cam = RTC.cameraSender(); this.pchg++; this.reason = why || this.reason;
    Bus.emit('log', `Priority decision for ${cls}: ${this.reason}`);
    Bus.emit('log', 'P1 audio: never throttled by the policy (Opus adapts by itself).');
    if (cam && await this.setEnc(cam, { maxBitrate: P.cam.kbps * 1000, maxFramerate: P.cam.fps, scaleResolutionDownBy: P.cam.scale })) {
      this.enc.cam = `${P.cam.kbps} kbps · ${P.cam.fps} fps · ÷${P.cam.scale}`; Bus.emit('log', 'P2 camera encoding set via setParameters: ' + this.enc.cam);
    }
    if (RTC.screenSender) {
      const s = P.screen;
      RTC.screenSender.track.enabled = s !== 'paused';
      if (s !== 'paused') await this.setEnc(RTC.screenSender, { maxBitrate: CONFIG.screenKbps[s] * 1000 });
      this.enc.screen = s === 'full' ? 'full quality' : s === 'capped' ? 'capped ' + CONFIG.screenKbps.capped + ' kbps' : 'paused (track.enabled=false)';
      Bus.emit('log', 'P3 screen share: ' + this.enc.screen);
    }
    Bus.emit('prio');
  },

  async simulateCap(on) {
    const cam = RTC.cameraSender(); if (!cam) throw new Error('No active camera sender.');
    await this.setEnc(cam, on ? { maxBitrate: 150000, scaleResolutionDownBy: 2 } : { maxBitrate: 1500000, scaleResolutionDownBy: 1 });
    Bus.emit('log', 'SIMULATED sender-side cap ' + (on ? 'enabled (150 kbps)' : 'removed') + ' — not a network impairment');
  },

  async stop() {
    clearInterval(this.tmr); this.on = false; Bus.emit('mon', false); Bus.emit('log', 'Monitoring stopped');
    if (!this.samples.length) { this.lastSummary = null; Bus.emit('summary', null); return; }
    const s = this.lastSummary = this.summary(); Bus.emit('summary', s);
    try { const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, id: this.sid, samples: this.samples, experiment_log: ExpLog }) });
      Bus.emit('log', r.ok ? 'Session saved to history' : 'Could not save session (HTTP ' + r.status + ')'); }
    catch (e) { Bus.emit('log', 'Could not save session: ' + e.message); }
  },

  summary() {
    const S = this.samples, avg = (rows, k) => { const x = rows.map(r => r[k]).filter(v => v != null); return x.length ? R(x.reduce((a, b) => a + b) / x.length, 2) : null; };
    const nm = S.filter(r => r.network_condition === 'Normal'), dg = S.filter(r => r.network_condition !== 'Normal');
    const missing = COLUMNS.filter(c => S.every(r => r[c] === null));
    return { id: this.sid, session_id: this.sid, room: RTC.room, started: new Date(this.t0).toISOString(), duration_s: Math.round((Date.now() - this.t0) / 1000),
      samples_n: S.length, avg_rtt_ms: avg(S, 'rtt_ms'), avg_jitter_ms: avg(S, 'jitter_ms'), avg_loss_pct: avg(S, 'packet_loss_pct'),
      avg_incoming_kbps: avg(S, 'incoming_bitrate_kbps'), avg_outgoing_kbps: avg(S, 'outgoing_bitrate_kbps'), avg_fps: avg(S, 'frames_per_second'), avg_qoe_overall: avg(S, 'overall_quality_score'),
      interruptions: this.recs.length + (this.intr > 0 ? 1 : 0), interruption_total_s: R(this.recs.reduce((a, b) => a + b, 0) + this.intr), avg_recovery_s: this.recs.length ? R(this.recs.reduce((a, b) => a + b) / this.recs.length) : null,
      priority_changes: this.pchg, normal: { samples: nm.length, avg_qoe: avg(nm, 'overall_quality_score'), avg_rtt_ms: avg(nm, 'rtt_ms'), avg_loss_pct: avg(nm, 'packet_loss_pct') },
      degraded_or_worse: { samples: dg.length, avg_qoe: avg(dg, 'overall_quality_score'), avg_rtt_ms: avg(dg, 'rtt_ms'), avg_loss_pct: avg(dg, 'packet_loss_pct') },
      unavailable_metrics: missing, browser: navigator.userAgent, note: 'Quality scores are heuristic estimates, not subjective ratings.' };
  },
  summaryText(s) {
    const f = v => v == null ? 'n/a' : v;
    return [`QoE-Net Labs experiment summary`, `Session: ${s.id}  Room: ${s.room}`, `Started: ${s.started}`, `Duration: ${s.duration_s} s   Samples: ${s.samples_n}`,
      `Avg RTT: ${f(s.avg_rtt_ms)} ms   Avg jitter: ${f(s.avg_jitter_ms)} ms   Avg loss: ${f(s.avg_loss_pct)} %`, `Avg incoming: ${f(s.avg_incoming_kbps)} kbps   Avg outgoing: ${f(s.avg_outgoing_kbps)} kbps   Avg FPS: ${f(s.avg_fps)}`,
      `Avg estimated QoE (heuristic): ${f(s.avg_qoe_overall)}`, `Interruptions: ${s.interruptions} (total ${s.interruption_total_s} s)   Avg recovery: ${f(s.avg_recovery_s)} s`, `Priority changes: ${s.priority_changes}`,
      `Normal periods: ${s.normal.samples} samples, QoE ${f(s.normal.avg_qoe)}, RTT ${f(s.normal.avg_rtt_ms)} ms, loss ${f(s.normal.avg_loss_pct)} %`,
      `Degraded/Poor/Intermittent: ${s.degraded_or_worse.samples} samples, QoE ${f(s.degraded_or_worse.avg_qoe)}, RTT ${f(s.degraded_or_worse.avg_rtt_ms)} ms, loss ${f(s.degraded_or_worse.avg_loss_pct)} %`,
      `Unavailable metrics in this browser/session: ${s.unavailable_metrics.join(', ') || 'none'}`, s.note].join('\n') + '\n';
  }
};
