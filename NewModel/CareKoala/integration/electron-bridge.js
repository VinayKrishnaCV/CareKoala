// Minimal bridge between the Electron main process and the CareKoala engine.
// The engine prints one JSON event per line on stdout and takes commands on stdin
// (protocol documented at the top of engine/monitor.py and in README.md).
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

function startCareKoala({ python = 'python', engineDir, interval = 20, alert = 7, emergency = 9, onEvent }) {
  const proc = spawn(
    python,
    [path.join(engineDir, 'monitor.py'), '--interval', String(interval), '--alert', String(alert), '--emergency', String(emergency)],
    { cwd: engineDir, windowsHide: true },
  );
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    try {
      onEvent(JSON.parse(line));
    } catch {
      /* ignore non-JSON output */
    }
  });
  proc.stderr.on('data', (d) => console.debug('[carekoala]', d.toString().trim()));
  const send = (cmd) => proc.stdin.write(JSON.stringify(cmd) + '\n');
  return {
    pause: () => send({ cmd: 'pause' }),
    resume: () => send({ cmd: 'resume' }),
    scanNow: () => send({ cmd: 'scan' }),
    scoreText: (text, id) => send({ cmd: 'score_text', text, id }),
    stop: () => send({ cmd: 'quit' }), // engine also exits when stdin closes
    proc,
  };
}

module.exports = { startCareKoala };

// Example wiring - replace notifyGuardian / runCrisisProtocol with the app's own logic.
//
// const ck = startCareKoala({
//   engineDir: path.join(process.resourcesPath, 'engine'),
//   onEvent: (ev) => {
//     if (ev.event !== 'scan') return;
//     if (ev.level === 'emergency') runCrisisProtocol(ev);   // score 9-10: call guardian + show helpline
//     else if (ev.level === 'alert') notifyGuardian(ev);     // score 7-8: message the guardian
//   },
// });
