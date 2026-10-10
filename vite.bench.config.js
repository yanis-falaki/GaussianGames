// Isolated server for benchmark runs: no HMR or file watching, so editing source while a long
// search runs can't reload the page under it.
import base from "./vite.config.js";
export default { ...base, server: { ...base.server, hmr: false, watch: null, port: 5182, strictPort: true } };
