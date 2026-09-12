import { mkdir, writeFile } from 'node:fs/promises';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { progressSchema, progressValidators } from './schemas/progress.mjs';

const ajv = new Ajv({ strict: true, allErrors: false, messages: false, code: { source: true, esm: true, optimize: 2 }, inlineRefs: false });
ajv.addSchema(progressSchema);
const exports = Object.fromEntries(Object.entries(progressValidators).map(([name, definition]) => [name, `progress#/$defs/${definition}`]));
const code = standaloneCode(ajv, exports).replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length').replaceAll('require("ajv/dist/runtime/equal").default', 'equal');
if (code.includes('require(')) throw new Error('Unexpected standalone runtime helper');
const helpers = 'import lengthModule from "ajv/dist/runtime/ucs2length.js";\nimport equalModule from "ajv/dist/runtime/equal.js";\nconst ucs2length = typeof lengthModule === "function" ? lengthModule : lengthModule.default;\nconst equal = typeof equalModule === "function" ? equalModule : equalModule.default;\n';
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/progress-validators.js', helpers + code);
