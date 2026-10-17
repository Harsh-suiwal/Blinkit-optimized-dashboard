// Used by `npm run deploy`: refuse to start the server when there is no Angular build to serve.
const fs = require('fs');
const path = require('path');

const indexHtml = path.join(__dirname, '..', 'client', 'dist', 'client', 'browser', 'index.html');

if (!fs.existsSync(indexHtml)) {
  console.error('No client build found. Run `npm run build` first (it builds and starts the app).');
  process.exit(1);
}
