/* Two-party WebRTC call: media, signaling (WebSocket + HTTP polling fallback), mic/camera/screen controls. */
const Bus = (() => { const h = {}; return { on: (e, f) => (h[e] = h[e] || []).push(f), emit: (e, d) => (h[e] || []).forEach(f => f(d)) }; })();
const RTC = { pc: null, local: null, screen: null, screenSender: null, room: '', name: '', ws: null, http: false, poll: null, since: 0,
  cid: Math.random().toString(36).slice(2, 10), offerer: false, renego: false, camStreamId: null, closing: false };
const $ = s => document.querySelector(s);
const log = m => Bus.emit('log', m);

RTC.send = function (msg) {
  if (RTC.http) return fetch('/api/signal/' + RTC.room, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: RTC.cid, msg }) })
    .catch(e => Bus.emit('error', 'HTTP signaling failed: ' + e.message));
  if (RTC.ws && RTC.ws.readyState === 1) RTC.ws.send(JSON.stringify(msg));
};

RTC.newPc = function () {
  const pc = RTC.pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
  pc.onicecandidate = e => e.candidate && RTC.send({ type: 'ice', c: e.candidate });
  pc.ontrack = e => {
    const s = e.streams[0]; if (!s) return;
    if (!RTC.camStreamId) RTC.camStreamId = s.id;
    if (s.id === RTC.camStreamId) $('#rv').srcObject = s;
    else { $('#rs').srcObject = s; $('#rsw').style.display = 'block'; e.track.onended = () => { $('#rsw').style.display = 'none'; }; s.onremovetrack = () => { $('#rsw').style.display = 'none'; }; }
  };
  pc.onconnectionstatechange = () => {
    Bus.emit('conn', pc.connectionState); Bus.emit('status', 'Connection: ' + pc.connectionState); log('Connection state: ' + pc.connectionState);
    if (pc.connectionState === 'connected') RTC.renego = true;
    if (pc.connectionState === 'failed') Bus.emit('error', 'WebRTC connection failed: no peer-to-peer path could be established (network/firewall; no TURN configured).');
  };
  pc.onnegotiationneeded = async () => {
    if (!(RTC.offerer || RTC.renego) || pc.signalingState !== 'stable') return;
    try { await pc.setLocalDescription(await pc.createOffer()); RTC.send({ type: 'sdp', d: pc.localDescription }); } catch (e) { Bus.emit('error', 'Negotiation failed: ' + e.message); }
  };
  RTC.local.getTracks().forEach(t => pc.addTrack(t, RTC.local));
};

RTC.onMsg = async function (m) {
  try {
    if (m.type === 'name') Bus.emit('remoteName', m.n);
    else if (m.type === 'welcome') { Bus.emit('status', 'Waiting for participant (' + m.peers + '/2)'); Bus.emit('peer', m.peers > 1); }
    else if (m.type === 'peer-joined') { RTC.offerer = true; RTC.renego = false; RTC.camStreamId = null; RTC.newPc(); RTC.send({ type: 'name', n: RTC.name }); Bus.emit('peer', true); log('Participant joined'); }
    else if (m.type === 'sdp') {
      if (!RTC.pc) RTC.newPc();
      const pc = RTC.pc;
      if (m.d.type === 'offer' && pc.signalingState !== 'stable') { if (RTC.offerer) return; await pc.setLocalDescription({ type: 'rollback' }); }
      await pc.setRemoteDescription(m.d); Bus.emit('peer', true);
      if (m.d.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); RTC.send({ type: 'sdp', d: pc.localDescription }); }
    }
    else if (m.type === 'ice' && RTC.pc) { try { await RTC.pc.addIceCandidate(m.c); } catch (e) { /* late candidate */ } }
    else if (m.type === 'peer-left') {
      log('Participant left'); Bus.emit('peer', false); Bus.emit('status', 'Participant left — waiting');
      if (RTC.pc) { RTC.pc.close(); RTC.pc = null; } RTC.offerer = false; RTC.renego = false; RTC.camStreamId = null; $('#rv').srcObject = null; $('#rsw').style.display = 'none'; Bus.emit('conn', 'closed');
    }
    else if (m.type === 'full') { Bus.emit('error', 'This room already has two participants. Choose a different Room ID.'); RTC.leave(true); }
  } catch (e) { Bus.emit('error', 'Signaling message error: ' + e.message); }
};

RTC.join = async function (room, name) {
  RTC.room = room; RTC.name = name || 'Participant'; RTC.closing = false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera/microphone API unavailable. Use HTTPS or localhost.');
  try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
  catch (e) { throw new Error('Could not access camera/microphone: ' + e.message); }
  $('#lv').srcObject = RTC.local;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  await new Promise((resolve, reject) => {
    let opened = false;
    const ws = RTC.ws = new WebSocket(`${proto}://${location.host}/api/ws/${encodeURIComponent(room)}`);
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ type: 'name', n: RTC.name })); resolve(); };
    ws.onmessage = e => RTC.onMsg(JSON.parse(e.data));
    ws.onclose = e => { if (opened && !RTC.closing && !RTC.http) Bus.emit('error', 'Signaling connection closed unexpectedly (code ' + e.code + ').'); };
    ws.onerror = () => { if (opened) return; RTC.useHttp().then(resolve, reject); };
  });
  Bus.emit('joined');
};

RTC.useHttp = async function () {
  RTC.http = true; log('WebSocket unavailable — using HTTP polling signaling');
  const r = await fetch('/api/signal/' + RTC.room + '?client=' + RTC.cid + '&since=0').catch(() => null);
  if (!r || !r.ok) { RTC.http = false; throw new Error('Signaling server unreachable (WebSocket and HTTP polling both failed).'); }
  RTC.since = (await r.json()).last;
  await RTC.send({ type: 'hello', n: RTC.name });
  RTC.poll = setInterval(async () => {
    try { const j = await (await fetch(`/api/signal/${RTC.room}?client=${RTC.cid}&since=${RTC.since}`)).json(); RTC.since = j.last;
      j.messages.forEach(x => x.msg.type === 'hello' ? (RTC.onMsg({ type: 'peer-joined' }), Bus.emit('remoteName', x.msg.n)) : RTC.onMsg(x.msg)); }
    catch (e) { Bus.emit('error', 'HTTP signaling poll failed: ' + e.message); }
  }, 1000);
  Bus.emit('status', 'Waiting for participant (HTTP polling)');
};

RTC.leave = function (silent) {
  RTC.closing = true; Bus.emit('leaving');
  clearInterval(RTC.poll); RTC.http = false;
  if (RTC.ws) { try { RTC.ws.close(1000); } catch (e) {} RTC.ws = null; }
  if (RTC.pc) { RTC.pc.close(); RTC.pc = null; }
  [RTC.local, RTC.screen].forEach(s => s && s.getTracks().forEach(t => t.stop()));
  RTC.local = RTC.screen = RTC.screenSender = null; RTC.offerer = RTC.renego = false; RTC.camStreamId = null;
  $('#lv').srcObject = $('#rv').srcObject = null; $('#rsw').style.display = 'none';
  Bus.emit('left');
};

RTC.toggle = function (kind) {
  const t = RTC.local && RTC.local.getTracks().filter(x => x.kind === kind); if (!t || !t.length) return null;
  t.forEach(x => x.enabled = !x.enabled); return t[0].enabled;
};
RTC.toggleScreen = async function () {
  if (RTC.screen) { RTC.screen.getTracks().forEach(t => t.stop()); if (RTC.pc && RTC.screenSender) RTC.pc.removeTrack(RTC.screenSender); RTC.screen = RTC.screenSender = null; return false; }
  if (!RTC.pc) throw new Error('Screen sharing needs a connected participant.');
  RTC.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
  RTC.screenSender = RTC.pc.addTrack(RTC.screen.getVideoTracks()[0], RTC.screen);
  RTC.screen.getVideoTracks()[0].onended = () => Bus.emit('screenEnded');
  return true;
};
RTC.cameraSender = () => RTC.pc && RTC.pc.getSenders().find(s => s.track && s.track.kind === 'video' && s !== RTC.screenSender);
