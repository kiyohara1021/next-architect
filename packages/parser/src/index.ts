export { discoverProject, ProjectDiscoveryError, type ProjectInfo } from "./discover.js";
export { extractAwaits } from "./awaits.js";
export {
  extractFromSourceFile,
  createProgram,
  createProjectSourceFile,
  loadCompilerContext,
  normalizeModuleId,
  type ExtractedModule,
  type RawImport,
  type CompilerContext,
} from "./extract.js";
export {
  parseProject,
  type ParsedProject,
  type ParseProjectOptions,
  type ResolveResult,
} from "./parse-project.js";
export { ModuleCache, hashFile, hashFileContent } from "./cache.js";
