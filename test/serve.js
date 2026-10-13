import http from 'http';
import fs from 'fs';
const fixture = fs.readFileSync(new URL('./fixture.html', import.meta.url));
http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture);
}).listen(4173, '127.0.0.1', () => console.log('映射测试页：http://127.0.0.1:4173/publish\n另一页面：http://127.0.0.1:4173/other'));
