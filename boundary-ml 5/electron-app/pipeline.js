// Bounded, overlapping windows retain every message and cross-window context.
function batches(messages) {
  const parts = messages.flatMap((m) => {
    const text = m.text.trim();
    return Array.from({length: Math.ceil(text.length / 2000)}, (_, i) => ({
      ...m, id: text.length > 2000 ? `${m.id}.${i + 1}` : m.id,
      text: text.slice(i * 2000, (i + 1) * 2000),
    }));
  });
  const result = [];
  for (let start = 0; start < parts.length;) {
    let end = start, size = 0;
    while (end < parts.length && end - start < 40 && size + parts[end].text.length <= 6000) {
      size += parts[end++].text.length;
    }
    result.push(parts.slice(start, end));
    if (end === parts.length) break;
    start = Math.max(start + 1, end - 4);
  }
  return result;
}
function merge(results) {
  const scored=results.filter(r=>Number.isInteger(r.score));
  if(scored.length){
    if(scored.length!==results.length)throw new Error('Incomplete trained-model results');
    const best=scored.reduce((a,b)=>b.score>a.score?b:a);
    return {...best,windows:scored.reduce((n,r)=>n+(r.windows||0),0)};
  }
  const concerns = new Map();
  for (const result of results) for (const c of result.concerns) {
    const existing = concerns.get(c.type);
    if (!existing) concerns.set(c.type, {...c, evidence_ids: [...c.evidence_ids]});
    else existing.evidence_ids = [...new Set([...existing.evidence_ids, ...c.evidence_ids])].slice(0, 12);
  }
  if (concerns.size) return {status: 'concern_detected', concerns: [...concerns.values()], clarifying_question: null};
  return results.find(r => r.status === 'insufficient_context') || {status: 'no_clear_concern', concerns: [], clarifying_question: null};
}
function protectPipe(stream) {
  stream.on('error', error => { if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') throw error; });
}
module.exports = {batches, merge, protectPipe};
