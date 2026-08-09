const fs = require("node:fs");
const path = require("node:path");

const dataDirectory = path.resolve(process.env.DATA_DIR || "./runtime");
const heartbeatPath = path.join(dataDirectory, "healthy");

try {
    const age = Date.now() - fs.statSync(heartbeatPath).mtimeMs;
    process.exit(age < 180_000 ? 0 : 1);
} catch {
    process.exit(1);
}
