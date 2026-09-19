import http from 'node:http';

const host = '127.0.0.1';
const port = 4873;
const delayMs = Number.parseInt(process.env.DELAY_MS ?? '250', 10);
let activeRequests = 0;
let peakRequests = 0;
let totalRequests = 0;

function packageMetadata(name) {
  return {
    name,
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        name,
        version: '1.0.0',
        dist: {
          tarball: `http://${host}:${port}/${name}/-/${name}-1.0.0.tgz`,
          integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        },
      },
    },
  };
}

const server = http.createServer((request, response) => {
  if (request.url === '/stats') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ activeRequests, peakRequests, totalRequests }));
    return;
  }
  if (request.url === '/reset') {
    activeRequests = 0;
    peakRequests = 0;
    totalRequests = 0;
    response.end('ok');
    return;
  }

  const packageName = decodeURIComponent(request.url.slice(1).split('/')[0]);
  if (!/^perf-package-\d{2}$/.test(packageName)) {
    response.statusCode = 404;
    response.end('not found');
    return;
  }

  activeRequests++;
  totalRequests++;
  peakRequests = Math.max(peakRequests, activeRequests);
  setTimeout(() => {
    response.setHeader('content-type', 'application/vnd.npm.install-v1+json');
    response.setHeader('cache-control', 'no-cache');
    response.end(JSON.stringify(packageMetadata(packageName)));
    activeRequests--;
  }, delayMs);
});

server.listen(port, host, () => {
  console.log(`registry ready at http://${host}:${port} with ${delayMs}ms latency`);
});

