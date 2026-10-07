import { start } from './app.mjs';

start().then(({ config }) => {
  console.log(`Skwid server listening on port ${config.port}`);
}).catch((error) => {
  console.error('Skwid server failed to start:', error.message);
  process.exitCode = 1;
});
