#!/usr/bin/env node

import('../dist/index.js').catch(async (err) => {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    // If not built yet, fallback to tsx or direct error
    console.error('ZIMBI CLI not compiled yet. Please run `npm run build`.');
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
