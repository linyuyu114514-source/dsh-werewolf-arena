/* 找这台机器上的 DeepSeek Harness。
   顺序：环境变量覆盖 -> 常见安装位置 -> 各盘根目录下的 "DeepSeek Harness"。
   换机器不用改代码，找不到时用 WW_DSH_HOME / WW_DSH_EXE / WW_DSH_CLI 兜底。 */
import '../env.mjs';   /* 先加载 .env，下面才能看到 DEEPSEEK_API_KEY */
import fs from 'node:fs';
import path from 'node:path';

function exists(p) {
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

/* ---------- 1. 安装目录候选 ---------- */
function installCandidates() {
  const list = [];
  const push = (p) => { if (p) list.push(norm(p)); };

  push(process.env.WW_DSH_HOME);

  const localAppData = process.env.LOCALAPPDATA;
  const progFiles = process.env.ProgramFiles || process.env.PROGRAMFILES;
  const progFiles86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'];
  if (localAppData) push(path.join(localAppData, 'Programs', 'DeepSeek Harness'));
  if (localAppData) push(path.join(localAppData, 'DeepSeek Harness'));
  if (progFiles) push(path.join(progFiles, 'DeepSeek Harness'));
  if (progFiles86) push(path.join(progFiles86, 'DeepSeek Harness'));

  /* 各盘根目录：装机时用户经常自己选盘 */
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    push(drive + ':/DeepSeek Harness');
  }
  return list;
}

const INSTALL = (function pick() {
  const list = installCandidates();
  for (const dir of list) {
    if (exists(dir + '/DeepSeek Harness.exe')) return dir;
  }
  return list[0] || 'C:/DeepSeek Harness';
})();

export const DSH_HOME_DIR = INSTALL;

/* ---------- 2. 可执行文件 ---------- */
export const DSH_EXE = (function pick() {
  const list = [];
  if (process.env.WW_DSH_EXE) list.push(norm(process.env.WW_DSH_EXE));
  list.push(INSTALL + '/DeepSeek Harness.exe');
  for (const p of list) if (exists(p)) return p;
  return list[0];
})();

/* ---------- 3. CLI 入口 ---------- */
/* 安装包有两种解包形态：resources/app/dsh 和 resources/app.asar/dsh，都试。 */
export const DSH_CLI = (function pick() {
  const rel = '/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js';
  const list = [];
  if (process.env.WW_DSH_CLI) list.push(norm(process.env.WW_DSH_CLI));
  list.push(INSTALL + '/resources/app/dsh' + rel);
  list.push(INSTALL + '/resources/app.asar/dsh' + rel);
  for (const p of list) if (exists(p)) return p;
  return list[0];
})();

/* ---------- 4. 随包附带的 node（没有就退回系统 node） ---------- */
export const DSH_NODE = (function pick() {
  const list = [];
  if (process.env.WW_NODE) list.push(norm(process.env.WW_NODE));
  list.push(INSTALL + '/resources/runtime/primary-runtime/dependencies/node/bin/node.exe');
  list.push(INSTALL + '/resources/runtime/primary-runtime/dependencies/node/bin/node');
  for (const p of list) if (exists(p)) return p;
  return '';
})();

/* ---------- 5. 真实 DSH_HOME（桌面版的家目录） ----------
   游戏自己跑在临时 DSH_HOME 里（局末零残留），但"非官方通道"的登录态、
   渠道台账、免费通道设置都存在这个真实目录下，所以它是只读的来源。 */
export const DSH_USER_HOME = (function pick() {
  const list = [];
  if (process.env.WW_DSH_USER_HOME) list.push(norm(process.env.WW_DSH_USER_HOME));
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) list.push(norm(home) + '/.dsh');
  if (process.env.DSH_HOME) list.push(norm(process.env.DSH_HOME));
  for (const p of list) if (exists(p)) return p;
  return list[0] || '';
})();

/* ---------- 6. 凭据 ---------- */
export const DSH_CREDENTIALS = (function pick() {
  const list = [];
  if (process.env.WW_DSH_CREDENTIALS) list.push(norm(process.env.WW_DSH_CREDENTIALS));
  /* 换了 DSH_HOME（例如别人机器上的另一个家目录）时，"有没有登录态"要按那个目录判 */
  if (process.env.WW_DSH_USER_HOME) list.push(norm(process.env.WW_DSH_USER_HOME) + '/.credentials.yaml');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) list.push(norm(home) + '/.dsh/.credentials.yaml');
  if (process.env.DSH_HOME) list.push(norm(process.env.DSH_HOME) + '/.credentials.yaml');
  for (const p of list) if (exists(p)) return p;
  return list[0] || '';
})();

export function hasCredentials() {
  return exists(DSH_CREDENTIALS);
}

export function hasApiKey() {
  const v = process.env.DEEPSEEK_API_KEY;
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 这一局用哪条认证路线。
 * - api-key：环境或 .env 里有 DEEPSEEK_API_KEY，走官方 API（deepseek-official）
 * - account：桌面版登录态，走账号通道（deepseek-account），不需要 Key
 * @returns {{route:'api-key'|'account'|'none', provider:string}}
 */
export function authRoute() {
  const forced = String(process.env.WW_AUTH || '').trim().toLowerCase();
  const api = hasApiKey();
  const acc = hasCredentials();
  if (forced === 'api-key') return { route: api ? 'api-key' : 'none', provider: 'deepseek-official' };
  if (forced === 'account') return { route: acc ? 'account' : 'none', provider: 'deepseek-account' };
  if (api) return { route: 'api-key', provider: 'deepseek-official' };
  if (acc) return { route: 'account', provider: 'deepseek-account' };
  return { route: 'none', provider: 'deepseek-official' };
}

export function dshUsable() {
  if (!exists(DSH_EXE) || !exists(DSH_CLI)) return false;
  return authRoute().route !== 'none';
}

/** 给 /api/health 和报错文案用的一句话诊断 */
export function dshDiagnosis() {
  if (!exists(DSH_EXE)) return '找不到 DeepSeek Harness 可执行文件（试过 ' + DSH_EXE + '）';
  if (!exists(DSH_CLI)) return '找不到 DeepSeek Harness 的 CLI 入口（试过 ' + DSH_CLI + '）';
  if (authRoute().route === 'none') {
    return 'DeepSeek Harness 已安装，但没有可用身份：在项目根目录 .env 里写 DEEPSEEK_API_KEY=sk-...，或先登录桌面版 DeepSeek Harness';
  }
  return '';
}