class AutoMode {
  constructor(ops) { this.ops=ops; this.running=false; this.pending=null; this.status='Stopped'; this.lastText=null; this.alerted=false; this.decision=null; }
  snapshot() { return {running:this.running, status:this.status, decision:this.decision, score:this.score??null,level:this.level??null,category:this.category??null}; }
  update(status) { this.status=status; this.ops.changed?.(this.snapshot()); }
  start() {
    if (this.pending) throw new Error('The previous cycle is still finishing. Please wait.');
    this.running=true; this.lastText=null; this.alerted=false; this.decision=null;this.score=null;this.level=null;this.category=null;
    this.pending=this.loop().finally(()=>{this.pending=null;});
  }
  stop() { this.running=false; this.update(this.pending?'Stopping after the active stage…':'Stopped'); }
  async loop() {
    try {
      while(this.running) {
        this.update('Capturing the entire screen');
        const images=await this.ops.capture();
        const messages=[];
        for(const image of images) {
          if(!this.running) break;
          this.update('Reading screen locally');
          const ocr=await this.ops.ocr(image);
          for(const line of ocr.lines || []) {
            if(line.text.trim()) messages.push({id:`M${messages.length+1}`,speaker:'other',text:line.text.trim()});
          }
        }
        if(!this.running) break;
        const fingerprint=this.ops.hash(messages.map(m=>m.text).join('\n'));
        if(fingerprint!==this.lastText) {
          this.update('Checking whether a guardian check-in is recommended');
          const decision=messages.length ? await this.ops.decide(messages) : null;
          if(!this.running) break;
          this.decision=decision;
          if(decision===true && !this.alerted) {
            this.update('Publishing encrypted guardian check-in request');
            const publication=await this.ops.alert();
            this.alerted=true;
            this.update(publication);
          } else if(decision===false) { this.alerted=false; this.update('Guardian check-in recommended: No'); }
          else if(decision===null) this.update('Decision unavailable — no alert sent');
          else this.update('Guardian check-in recommended: Yes — already alerted');
          this.lastText=fingerprint;
        } else this.update('Screen text unchanged; continuing local monitoring');
        // Processing completion, not a fixed capture timer, starts the next cycle.
        await new Promise(resolve=>setImmediate(resolve));
      }
    } catch(error) { this.running=false; this.update(`Paused: ${error.message}`); }
    finally { if(!this.status.startsWith('Paused:')) this.update('Stopped'); }
  }
}
module.exports={AutoMode};
