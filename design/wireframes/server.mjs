import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const requestedPort = Number.parseInt(process.env.PORT || '8000', 10);
const host = process.env.HOST || '127.0.0.1';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/babel; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(root + sep);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname === '/' ? '/Corum Wireframes.html' : url.pathname;
    const filePath = resolve(root, `.${decodeURIComponent(pathname)}`);

    if (!isInsideRoot(filePath)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function listen(port) {
  const server = createServer(handleRequest);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < requestedPort + 20) {
      listen(port + 1);
      return;
    }

    console.error(error.message);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Corum wireframes: http://${host}:${port}/Corum%20Wireframes.html`);
    console.log('Press Ctrl+C to stop.');
  });
}

listen(requestedPort);
