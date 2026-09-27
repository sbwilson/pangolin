// `pnpm mock:prices [--port 4020] [--host 127.0.0.1] [--fixtures <dir>]`: serves the price
// fixtures until interrupted.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultFixturesDir, startMockPrices } from "./server.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4020" },
    host: { type: "string", default: "127.0.0.1" },
    fixtures: { type: "string" },
  },
  strict: true,
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid --port: ${values.port}`);
  process.exit(1);
}

const fixturesDir = values.fixtures === undefined ? defaultFixturesDir : resolve(values.fixtures);
const server = await startMockPrices({ port, host: values.host, fixturesDir });
console.log(`mock-prices listening on ${server.url} (fixtures: ${fixturesDir})`);

const stop = () => {
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
