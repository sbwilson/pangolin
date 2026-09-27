// The admin entry: commands that run as `SystemViewer` (AD-6, AD-16).
export { type AppliedSeed, applySeed, parseSeed, type SeedDeps } from "./seed.ts";
export { type FirstSetupLinkDeps, SETUP_LINK_FILE, writeFirstSetupLink } from "./setup-link.ts";
