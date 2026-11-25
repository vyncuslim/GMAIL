import { build } from 'esbuild';
import { builtinModules } from 'node:module';

// Convert legacy CommonJS requires of Node builtins into static node: imports.
// This avoids a runtime `require` shim in the ES-module Worker.
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
await build({
  entryPoints: ['src/index.mjs'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'import', 'default'],
  mainFields: ['module', 'main'],
  sourcemap: false,
  external: ['node:*'],
  plugins: [{
    // web-push's Node-only sendNotification method imports proxy transports,
    // including an optional native Kerberos package. This Worker only calls
    // generateRequestDetails and sends via fetch; disable the unused transport
    // explicitly without altering its maintained encryption/VAPID code.
    name: 'disable-unused-node-proxy',
    setup(builder) {
      builder.onResolve({ filter: /^https-proxy-agent$/ }, () => ({ path: 'proxy', namespace: 'disabled-transport' }));
      builder.onLoad({ filter: /.*/, namespace: 'disabled-transport' }, () => ({
        contents: 'export class HttpsProxyAgent { constructor() { throw new Error("Node proxy transport is unavailable; use Worker fetch."); } }',
        loader: 'js',
      }));
    },
  }, {
    name: 'node-builtin-esm',
    setup(builder) {
      builder.onResolve({ filter: /^[a-z][a-z0-9_/-]*$/ }, (args) => {
        if (builtins.has(args.path)) return { path: args.path, namespace: 'node-builtin' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'node-builtin' }, (args) => ({
        contents: `import * as builtin from ${JSON.stringify('node:' + args.path)}; module.exports = builtin.default ?? { ...builtin };`,
        loader: 'js',
      }));
    },
  }],
});
