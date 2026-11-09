import { createRequire } from 'module';
import middleware from './_common/middleware.js';
import { parseTarget } from './_common/parse-target.js';

const require = createRequire(import.meta.url);
const Traceroute = require('nodejs-traceroute');

const LOCAL_TIMEOUT = 8000;

// Convert nodejs-traceroute hop events into [{ip, time}] format expected by the UI
const collectHops = (hostname) =>
  new Promise((resolve, reject) => {
    const hops = [];
    const tracer = new Traceroute();
    const timer = setTimeout(() => {
      tracer.kill?.();
      reject(new Error('Traceroute timed out'));
    }, LOCAL_TIMEOUT);

    tracer
      .on('hop', (hop) => {
        if (hop?.ip && hop.ip !== '*') {
          const time = parseFloat(String(hop.rtt1 || hop.rtt || '').replace(/\s*ms/i, '')) || 0;
          hops.push({ ip: hop.ip, time });
        }
      })
      .on('close', () => {
        clearTimeout(timer);
        resolve(hops);
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

    try {
      tracer.trace(hostname);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });

const isMissingBinary = (err) =>
  err?.code === 'ENOENT' ||
  /command not found|not installed|traceroute/i.test(err?.message || '');

const traceRouteHandler = async (url) => {
  const start = Date.now();
  const { hostname } = parseTarget(url);
  let hops;
  try {
    hops = await collectHops(hostname);
  } catch (err) {
    if (isMissingBinary(err)) {
      return {
        skipped:
          'Traceroute binary is not available in this environment (common on Netlify serverless). ' +
          'The nodejs-traceroute package is installed, but it still requires the system traceroute/tracert binary. ' +
          'Use Docker for full traceroute support, or self-host on a system with the package installed.',
      };
    }
    return { error: `Traceroute failed: ${err.message}` };
  }
  if (!hops.length) {
    return { skipped: 'Traceroute returned no answered hops for this host' };
  }
  return {
    message: 'Traceroute completed!',
    result: hops.map(({ ip, time }) => ({ [ip]: [time] })),
    timeTaken: Date.now() - start,
  };
};

export const handler = middleware(traceRouteHandler);
export default handler;
