/* CSV schema, validation and export (pure functions, no DOM). */
const COLUMNS = ['video_id','timestamp','session_id','sample_num','rtt_ms','jitter_ms','packet_loss_pct','available_bandwidth_kbps','incoming_bitrate_kbps','outgoing_bitrate_kbps','audio_bitrate_kbps','audio_packet_loss_pct','video_bitrate_kbps','video_packet_loss_pct','frames_per_second','frames_dropped','freeze_count','freeze_duration_ms','audio_concealment_events','network_condition','connectivity_status','interruption_duration_s','recovery_time_ms','stream_type','audio_quality_score','video_quality_score','overall_quality_score','qoe_class'];
const STRING_COLS = new Set(['video_id','timestamp','session_id','network_condition','connectivity_status','stream_type','qoe_class']);
const ENUMS = { network_condition: ['Normal','Degraded','Poor','Intermittent'], qoe_class: ['Good','Fair','Poor'] };

function validateRow(row) {
  const errs = [];
  for (const c of COLUMNS) {
    if (!(c in row)) { errs.push('missing column ' + c); continue; }
    const v = row[c];
    if (v === null) continue;                                   // unavailable metric is allowed
    if (STRING_COLS.has(c)) { if (typeof v !== 'string') errs.push(c + ' must be string'); }
    else if (typeof v !== 'number' || !isFinite(v)) errs.push(c + ' must be a finite number or null');
    if (ENUMS[c] && !ENUMS[c].includes(v)) errs.push(c + ' has invalid value ' + v);
  }
  if (row.sample_num !== null && (!Number.isInteger(row.sample_num) || row.sample_num < 1)) errs.push('sample_num must be an integer >= 1');
  return errs;
}
const csvCell = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
function toCsv(rows) {
  const ok = [], bad = [];
  rows.forEach(r => { const e = validateRow(r); e.length ? bad.push({ sample_num: r.sample_num, errors: e }) : ok.push(r); });
  const text = [COLUMNS.join(',')].concat(ok.map(r => COLUMNS.map(c => csvCell(r[c])).join(','))).join('\n') + '\n';
  return { text, exported: ok.length, rejected: bad };
}
if (typeof module !== 'undefined') module.exports = { COLUMNS, validateRow, toCsv };
