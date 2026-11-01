/* All tunable parameters. Edit here; the About page shows the values in use. */
const CONFIG = {
  sampleMs: 5000,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],   // add a TURN server here for strict NATs
  // Network condition thresholds (prototype categories, not standards)
  thresholds: {
    degraded: { rttMs: 200, jitterMs: 50, lossPct: 3 },
    poor:     { rttMs: 400, jitterMs: 100, lossPct: 10 }
    // "Intermittent" = zero incoming media bytes in a sample interval, or connection state disconnected/failed
  },
  // Heuristic QoE (estimated, 1..5)
  qoe: {
    base: 4.5,
    audio: { lossPerPct: 0.25, rttFreeMs: 150, rttPerMs: 200, jitterFreeMs: 30, jitterPerMs: 50, concealPerEvent: 0.05, concealMax: 1 },
    video: { lossPerPct: 0.25, fpsTarget: 24, fpsPenaltyMax: 1.5, freezePerEvent: 0.5, freezeMax: 1.5, dropPerFrame: 0.02, dropMax: 0.5, minBitrateKbps: 300, bitratePenaltyMax: 1 },
    weights: { audio: 0.4, video: 0.6 },
    interruptionScoreCap: 1,
    classes: { good: 3.8, fair: 2.8 }          // >= good → Good, >= fair → Fair, else Poor
  },
  // Priority policy: P1 audio is never throttled. P2 camera encoding, P3 screen share.
  policy: {
    Normal:       { cam: { kbps: 1500, fps: 30, scale: 1 },   screen: 'full' },
    Degraded:     { cam: { kbps: 600,  fps: 20, scale: 1.5 }, screen: 'capped' },
    Poor:         { cam: { kbps: 250,  fps: 15, scale: 2 },   screen: 'paused' },
    Intermittent: { cam: { kbps: 250,  fps: 15, scale: 2 },   screen: 'paused' }
  },
  screenKbps: { full: 2000, capped: 300 }
};
