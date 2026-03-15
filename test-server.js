// Minimal test — does Node.js HTTP work on this machine?
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('XSpan test OK');
});
server.listen(3000, '127.0.0.1', () => {
  console.log('Test server running on http://localhost:3000');
});
server.on('error', (err) => {
  console.error('Server error:', err.message);
});
