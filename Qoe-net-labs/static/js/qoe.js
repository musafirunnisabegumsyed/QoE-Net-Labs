/* QoE estimation + network classification. Pure functions, driven by CONFIG. */
const QoE = {
  predictor: null,   // Plug in a trained model later: { predict(features) -> {audio, video, overall} }. null = heuristic.
  clamp: x => Math.max(1, Math.min(5, x)),
  heuristic(f) {
    const c = CONFIG.qoe, a = c.audio, v = c.video, K = QoE.clamp;
    let A = null, V = null;
    if (f.audioKbps != null) {
      A = K(c.base - a.lossPerPct * (f.audioLoss ?? f.loss ?? 0)
        - Math.max(0, ((f.rtt || 0) - a.rttFreeMs) / a.rttPerMs)
        - Math.max(0, ((f.jitter || 0) - a.jitterFreeMs) / a.jitterPerMs)
        - Math.min(a.concealMax, (f.concealment || 0) * a.concealPerEvent));
    }
    if (f.fps != null) {
      V = K(c.base - v.lossPerPct * (f.videoLoss ?? f.loss ?? 0)
        - Math.min(v.fpsPenaltyMax, Math.max(0, (v.fpsTarget - f.fps) / v.fpsTarget * v.fpsPenaltyMax))
        - Math.min(v.freezeMax, (f.freezes || 0) * v.freezePerEvent)
        - Math.min(v.dropMax, (f.dropped || 0) * v.dropPerFrame)
        - (f.videoKbps != null ? Math.min(v.bitratePenaltyMax, Math.max(0, (v.minBitrateKbps - f.videoKbps) / v.minBitrateKbps * v.bitratePenaltyMax)) : 0));
    }
    let O = A != null && V != null ? c.weights.audio * A + c.weights.video * V : (A ?? V);
    if (O != null && f.interruption > 0) O = Math.min(O, c.interruptionScoreCap);
    return { audio: A, video: V, overall: O };
  },
  estimate(f) { return QoE.predictor ? QoE.predictor.predict(f) : QoE.heuristic(f); },
  qoeClass(o) { return o == null ? null : o >= CONFIG.qoe.classes.good ? 'Good' : o >= CONFIG.qoe.classes.fair ? 'Fair' : 'Poor'; },
  label(o) { return o == null ? 'no data' : o >= 4.3 ? 'Excellent' : o >= 3.6 ? 'Good' : o >= 2.6 ? 'Fair' : o >= 1.8 ? 'Poor' : 'Bad'; },
  classify(f) {
    const T = CONFIG.thresholds, why = [];
    const f1 = (n, v, u) => v == null ? null : n + ' ' + (+v).toFixed(1) + u;
    const obs = [f1('RTT', f.rtt, ' ms'), f1('jitter', f.jitter, ' ms'), f1('loss', f.loss, ' %')].filter(Boolean).join(', ') || 'no network metrics available';
    if (f.interruption > 0 || ['disconnected', 'failed'].includes(f.conn)) return { cls: 'Intermittent', why: `Media interrupted for ${f.interruption || 0} s or connection ${f.conn}. Observed: ${obs}.` };
    const hit = lvl => (f.rtt != null && f.rtt > T[lvl].rttMs && why.push('RTT>' + T[lvl].rttMs)) | (f.jitter != null && f.jitter > T[lvl].jitterMs && why.push('jitter>' + T[lvl].jitterMs)) | (f.loss != null && f.loss > T[lvl].lossPct && why.push('loss>' + T[lvl].lossPct + '%'));
    if (hit('poor')) return { cls: 'Poor', why: `Exceeds poor threshold (${why.join(', ')}). Observed: ${obs}.` };
    why.length = 0;
    if (hit('degraded')) return { cls: 'Degraded', why: `Exceeds degraded threshold (${why.join(', ')}). Observed: ${obs}.` };
    return { cls: 'Normal', why: `Within thresholds. Observed: ${obs}.` };
  }
};
if (typeof module !== 'undefined') module.exports = QoE;
