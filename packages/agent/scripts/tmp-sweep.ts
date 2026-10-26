// Manual reclamation of leaked run dirs (same sweeper the server runs at
// boot). `pnpm --filter @rextor/agent tmp:sweep` — prints the swept result as
// JSON; exit 0 even with per-dir errors (they are listed in the output).
import { sweepStaleTmpDirs } from "../src/tmp-sweep";

const swept = await sweepStaleTmpDirs();
console.log(JSON.stringify(swept, null, 2));
