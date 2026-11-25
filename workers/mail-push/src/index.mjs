// Export only the fetch handler from the deployed module. Test helpers remain
// importable from worker.mjs without becoming Worker RPC entrypoints.
export { default } from './worker.mjs';
