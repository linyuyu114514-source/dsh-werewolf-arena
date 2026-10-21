/* 每局生成一份 patch.yml：
   接上身份（账号登录态 或 API Key 二选一）+ 挂上狼人杀插件 + 关掉用不上的工具插件。
   关掉持久化（sessions）是为了局末零残留——一局打完磁盘上什么都不留。 */
import fs from 'node:fs';
import path from 'node:path';
import { DSH_CREDENTIALS, hasCredentials } from './paths.mjs';

/* 这些插件在陪玩场景里只会浪费模型的步骤：模型会去摸文件系统、开 shell、读图片。 */
const DISABLED = [
  'sessions',              // 不落盘
  'tool-fs',
  'tool-working-directory',
  'persistent-bash',
  'persistent-pwsh',
  'terminal-bash',
  'terminal-pwsh',
  'pty',
  'subprocess',
  'jobs',
  'mcp-resources',
  'attachment-local',
  'compaction-basic',
  'image-offload',
  'session-title',
];

function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/* 空凭据文件：没有登录态时也要让 credentials 服务正常起来，
   这样 API Key 才能从进程环境/.env 里回退解析出来。 */
const EMPTY_CREDENTIALS = 'version: 1\nrecords: {}\nrefs: {}\n';

/**
 * @param {object} o
 * @param {string} o.outFile   写到哪
 * @param {string} o.pluginPath werewolf-plugin.mjs 的绝对路径
 * @param {string} o.rosterPath 本局座位表 JSON 的绝对路径
 * @returns {string} 写好的 patch 文件路径
 */
export function writePatch(o) {
  let credPath = DSH_CREDENTIALS;
  if (!hasCredentials()) {
    /* 没有 .credentials.yaml：临时造一个空文件，避免服务起不来 */
    credPath = path.join(path.dirname(o.outFile), 'empty-credentials.yaml');
    fs.writeFileSync(credPath, EMPTY_CREDENTIALS, 'utf8');
  }

  const lines = [];

  lines.push('- insert:');
  lines.push('    - id: credentials');
  lines.push("      name: '@deepseek-ai/dsh-credentials-local'");
  lines.push('      config:');
  lines.push('        path: ' + q(credPath));
  lines.push('        watch: false');
  lines.push('    - id: authorization');
  lines.push("      name: '@deepseek-ai/dsh-authorization'");
  lines.push('    - id: deepseek-account');
  lines.push("      name: '@deepseek-ai/dsh-deepseek-account-platform'");
  lines.push('    - id: llm-deepseek-account');
  lines.push("      name: '@deepseek-ai/dsh-llm-deepseek-account'");

  /* API Key 路线不用额外挂：sdk-minimal 自带的 llm-deepseek 就是
     @deepseek-ai/dsh-llm-deepseek-api-key（provider=deepseek-official）。
     它的 resolveApiKey 在 credentials 服务存在时会先查文件、再回退到启动环境，
     所以 DEEPSEEK_API_KEY 放在 .env 里就能被认出来。 */

  lines.push('    - id: werewolf');
  lines.push('      name: ' + q(o.pluginPath));
  lines.push('      config:');
  lines.push('        rosterPath: ' + q(o.rosterPath));

  for (const id of DISABLED) {
    lines.push('- id: ' + id);
    lines.push('  disabled: true');
  }

  const text = lines.join('\n') + '\n';
  fs.mkdirSync(path.dirname(o.outFile), { recursive: true });
  fs.writeFileSync(o.outFile, text, 'utf8');
  return o.outFile;
}