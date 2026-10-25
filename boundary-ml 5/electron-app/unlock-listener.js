function listen({
  url,
  topic,
  onMessage,
  onState = () => {},
  idleMs = 100000,
  retryMs = 1000,
  maxRetryMs = 30000,
}) {
  let stopped = false,
    abort = null,
    wake = null;
  const seen = new Set();
  const sleep = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  const done = (async () => {
    let delay = retryMs;
    while (!stopped) {
      abort = new AbortController();
      let idle;

      const bump = () => {
        clearTimeout(idle);
        idle = setTimeout(() => abort.abort(), idleMs);
      };
      try {
        bump();
        const response = await globalThis.fetch(url, {
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: abort.signal,
        });
        if (!response.ok || !response.body) throw Error("Relay unavailable");
        onState("listening");
        delay = retryMs;
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          bump();
          buffer += decoder.decode(chunk, { stream: true });
          for (let i; (i = buffer.indexOf("\n")) >= 0; ) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            let record;
            try {
              record = JSON.parse(line);
            } catch {
              continue;
            }

            if (
              record?.event !== "message" ||
              record.topic !== topic ||
              typeof record.message !== "string" ||
              typeof record.id !== "string" ||
              seen.has(record.id)
            )
              continue;
            if (seen.size >= 1000) seen.clear();
            seen.add(record.id);
            try {
              await onMessage(record.message);
            } catch {}
            if (stopped) return;
          }
          if (buffer.length > 16384) throw Error("Oversized relay record");
        }
        throw Error("Relay disconnected");
      } catch {
        if (!stopped) onState("retrying");
      } finally {
        clearTimeout(idle);
      }
      if (stopped) break;
      await sleep(delay);
      delay = Math.min(maxRetryMs, delay * 2);
    }
  })();
  return {
    done,
    stop() {
      stopped = true;
      abort?.abort();
      wake?.();
    },
  };
}
module.exports = { listen };
