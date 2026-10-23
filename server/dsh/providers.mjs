/* "当前 DSH 接入了哪些通道、每个通道有哪些模型"——这份列表从 DSH 自己嘴里问出来。

   做法：起一个短命 DSH 进程（sdk-minimal + 一份临时 patch），patch 里
     1) 指向临时 DSH_HOME（真实状态复制进去，见 home.mjs）；
     2) 挂上本机桌面版里装好的第三方通道插件（见 discoverProviderPlugins）；
     3) 挂上自带的枚举插件 enumerate-plugin.mjs。
   枚举插件把 llm.listProviders()/listModels() 的结果写进文件，我们读走、关进程。

   只查目录不打模型，所以不花 token；结果缓存 10 分钟，服务启动时后台预热一次。

   非官方通道插件是"从桌面版那边借"的：它需要玩家在桌面版里登录过对应渠道。
   借不到（没装 / 枚举失败）不算致命——回退成两条官方通道，并在 diagnostics 里
   写清楚为什么，前端照原样显示。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DSH_EXE, DSH_CLI, DSH_USER_HOME, authRoute, hasApiKey, hasCredentials } from './paths.mjs';

/** 桌面版登录态到底有没有：以"播种临时 DSH_HOME 的那个目录"为准，
    免得出现"界面说可用、开局才发现没登录"这种不一致。 */
function hasAccountCredentials() {
  if (DSH_USER_HOME) {
    try { return fs.existsSync(path.join(DSH_USER_HOME, '.credentials.yaml')); } catch { return false; }
  }
  return hasCredentials();
}

/* 借用过来的插件包要被"搬"出来才能正常加载：
   桌面版 profile 的 node_modules 是 pnpm 布局，@deepseek-ai/* 的 peer 依赖
   （cordis / dsh-llm / dsh-credentials / schemastery）在那儿解析不到——
   实测直接从原路径加载时，插件会少注册 11 个账号渠道，只剩匿名免费通道。

   所以复制一份插件包到临时目录，并在旁边摆一个 node_modules，
   里面是它的 peer 依赖（指向 DSH 自带的那份）。实测这样渠道才是齐的。 */
const PLUGIN_CACHE_ROOT = path.join(os.tmpdir(), 'ww-provider-plugins');

/** 插件 peer 依赖要放置的目录名（这个名字决定解析路径走向） */
const DEP_SCOPE = 'node_modules';
import { seedHome } from './home.mjs';
import { DISABLED } from './patch.mjs';

const ENUM_PLUGIN = path.join(import.meta.dirname, 'enumerate-plugin.mjs');

/** 枚举结果缓存多久 */
const TTL_MS = 10 * 60 * 1000;
/** 一次枚举最多等多久（进程起不来 / 渠道插件迟迟不上线时到点就走） */
const PROBE_TIMEOUT_MS = 30_000;
/** 等够这么多批快照就收工。账号类渠道上线得晚（要读台账、跑签到），
    只等前几批会稳定地漏掉它们——实测 7 秒时只有匿名免费通道，18 秒才齐。 */
const PROBE_MIN_SNAPSHOTS = 5;
/** 连续两批通道集合完全一样、且已经等够这么久，就可以提前收工 */
const PROBE_SETTLE_MS = 12_000;

/** 官方通道没有模型清单时给的兜底模型（这两个通道本来就只有 flash） */
const OFFICIAL_MODELS = {
  'deepseek-account': ['deepseek-flash'],
  'deepseek-official': ['deepseek-flash'],
};

/** 通道的中文名。DSH 自己报了名字就用它，没报的用这张表 */
const LABELS = {
  'deepseek-official': 'DeepSeek 官方 API Key',
  'deepseek-account': 'DeepSeek 官方账号',
  codearts: 'CodeArts（华为云）',
  lobsterai: 'LobsterAI（有道）',
  qoder: 'Qoder',
  qodercn: 'Qoder 中国版',
  trae: 'TRAE（字节）',
  cline: 'Cline',
  loomy: 'Loomy（讯飞）',
  raccoon: 'Raccoon（商汤）',
  minimax: 'MiniMax Code',
  zcode: 'ZCode（智谱）',
  gemini: 'Gemini',
  'our-free-model': '免费通道（匿名）',
  'our-free-model-region': '免费通道（区域）',
};

/* ------------------------------------------------------------
   1. 找本机装好的第三方通道插件
   ------------------------------------------------------------ */

function profilesDirs() {
  const out = [];
  if (!DSH_USER_HOME) return out;
  const root = path.join(DSH_USER_HOME, 'profiles');
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of names) if (e.isDirectory()) out.push(path.join(root, e.name));
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** 这个包是不是"给 DSH 提供 LLM 通道"的插件：看它是不是依赖 dsh-llm */
function providesLlm(dir) {
  const j = readJson(path.join(dir, 'package.json'));
  if (!j) return false;
  const peers = j.peerDependencies || {};
  return Boolean(peers['@deepseek-ai/dsh-llm']);
}

/** 包入口（绝对路径）。没有明确入口就用 index.js */
function entryOf(dir) {
  const j = readJson(path.join(dir, 'package.json'));
  if (!j) return '';
  const rel = typeof j.main === 'string' && j.main ? j.main : './index.js';
  const full = path.resolve(dir, rel);
  return fs.existsSync(full) ? full : '';
}

function slug(name) {
  return 'ofm-' + String(name).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/**
 * 扫桌面版各 profile 的 package.json（bundles）与 cordis.patch.yml，
 * 找出可挂进游戏进程的第三方 LLM 通道插件。
 * @returns {Array<{id:string, package:string, packageDir:string, entryPath:string}>}
 */
export function discoverProviderPlugins() {
  const found = [];
  const seen = new Set();
  const push = (name, dir) => {
    if (seen.has(dir)) return;
    if (!providesLlm(dir)) return;
    const entryPath = entryOf(dir);
    if (!entryPath) return;
    seen.add(dir);
    found.push({ id: slug(name), package: name, packageDir: dir, entryPath });
  };

  for (const profileDir of profilesDirs()) {
    const pkg = readJson(path.join(profileDir, 'package.json'));
    const bundles = (((pkg || {}).dsh || {}).profile || {}).bundles || [];
    for (const name of Array.isArray(bundles) ? bundles : []) {
      if (typeof name !== 'string') continue;
      /* 官方包由 sdk-minimal 与 patch.mjs 自己负责，这里不重复挂 */
      if (name.indexOf('@deepseek-ai/') === 0) continue;
      push(name, path.join(profileDir, 'node_modules', ...name.split('/')));
    }
    /* 有的插件只在 patch 层被点名，不在 bundles 里 */
    const patch = (() => { try { return fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'); } catch { return ''; } })();
    const re = /name:\s*'((?:@[^'\/]+\/)?[^'\/]+)'/g;
    let m;
    while ((m = re.exec(patch)) !== null) {
      const name = m[1];
      if (name.indexOf('@deepseek-ai/') === 0) continue;
      push(name, path.join(profileDir, 'node_modules', ...name.split('/')));
    }
  }
  return found;
}

/** DSH 自带的 node_modules（peer 依赖的解析源） */
function appModulesDir() {
  try {
    return path.resolve(DSH_CLI, '..', '..', '..', '..');
  } catch { return ''; }
}

function mtimeOf(file) {
  try { return String(fs.statSync(file).mtimeMs); } catch { return '0'; }
}

/** 把一个包（可能是符号链接）连同内容复制过去 */
function copyTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true, force: true });
}

/** 在 node_modules 里摆一份依赖：先试 junction（不需要管理员权限），不行就复制 */
function linkDep(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) return true;
  try {
    fs.symlinkSync(from, to, 'junction');
    return true;
  } catch { /* 没权限就复制 */ }
  try {
    fs.cpSync(from, to, { recursive: true, dereference: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把发现的第三方通道插件搬到一个能正常加载的位置，并把 peer 依赖摆好。
 * @returns {Array<{id:string, package:string, entryPath:string}>}
 */
export function materializeProviderPlugins() {
  const found = discoverProviderPlugins();
  if (!found.length) return [];
  const out = [];
  const moduleRoots = [appModulesDir(), ...profilesDirs().map((d) => path.join(d, 'node_modules'))].filter(Boolean);

  for (const p of found) {
    const destDir = path.join(PLUGIN_CACHE_ROOT, p.id);
    const stampFile = path.join(destDir, '.ww-stamp');
    const stamp = p.packageDir + '|' + mtimeOf(path.join(p.packageDir, 'package.json'));
    let fresh = false;
    try { fresh = fs.readFileSync(stampFile, 'utf8').trim() === stamp; } catch { fresh = false; }

    if (!fresh) {
      try {
        copyTree(p.packageDir, destDir);
        const pkg = readJson(path.join(destDir, 'package.json')) || {};
        const peers = Object.keys(pkg.peerDependencies || {});
        for (const name of peers) {
          const dest = path.join(PLUGIN_CACHE_ROOT, DEP_SCOPE, name);
          if (fs.existsSync(dest)) continue;
          for (const root of moduleRoots) {
            const src = path.join(root, ...name.split('/'));
            if (fs.existsSync(src) && linkDep(src, dest)) break;
          }
        }
        fs.writeFileSync(stampFile, stamp, 'utf8');
      } catch { /* 搬不动就退回原路径，至少匿名免费通道还能用 */ }
    }

    const rel = path.relative(p.packageDir, p.entryPath) || 'index.js';
    const entry = fs.existsSync(path.join(destDir, rel)) ? path.join(destDir, rel) : p.entryPath;
    out.push({ id: p.id, package: p.package, entryPath: entry });
  }
  return out;
}

export function cleanupProviderPlugins() {
  try { fs.rmSync(PLUGIN_CACHE_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
}

/* ------------------------------------------------------------
   2. 起短命进程问一次
   ------------------------------------------------------------ */

function q(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** 枚举用的 patch：只挂凭据、commands、第三方通道插件、枚举插件 */
function buildProbePatch(o) {
  const lines = [];
  lines.push('- insert:');
  lines.push('    - id: credentials');
  lines.push("      name: '@deepseek-ai/dsh-credentials-local'");
  lines.push('      config:');
  lines.push('        path: ' + q(o.credentialsPath));
  lines.push('        watch: false');
  lines.push('    - id: commands');
  lines.push("      name: '@deepseek-ai/dsh-commands'");
  /* 官方账号通道也要出现在列表里：它就是"没选通道时"的默认身份，
     列举时必须和真实开局用的一致。 */
  lines.push('    - id: authorization');
  lines.push("      name: '@deepseek-ai/dsh-authorization'");
  lines.push('    - id: deepseek-account');
  lines.push("      name: '@deepseek-ai/dsh-deepseek-account-platform'");
  lines.push('    - id: llm-deepseek-account');
  lines.push("      name: '@deepseek-ai/dsh-llm-deepseek-account'");
  for (const p of o.plugins) {
    lines.push('    - id: ' + p.id);
    lines.push('      name: ' + q(p.entryPath));
    lines.push('      config: {}');
  }
  lines.push('    - id: ww-enumerate');
  lines.push('      name: ' + q(ENUM_PLUGIN));
  lines.push('      config:');
  lines.push('        out: ' + q(o.outFile));
  for (const id of DISABLED) {
    lines.push('- id: ' + id);
    lines.push('  disabled: true');
  }
  return lines.join('\n') + '\n';
}

function runProbe(o) {
  return new Promise((resolve) => {
    let child = null;
    let stderrTail = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      try { child && child.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    try {
      child = spawn(DSH_EXE, ['--expose-internals', DSH_CLI, '--profile', 'sdk-minimal', '--patch', o.patchPath], {
        cwd: o.cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: o.home },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({ snapshots: [], stderr: '启动失败：' + e.message });
      return;
    }

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (s) => { stderrTail = (stderrTail + s).slice(-4000); });
    child.on('error', (e) => finish({ snapshots: [], stderr: '子进程错误：' + e.message }));

    const readSnapshots = () => {
      try {
        const j = JSON.parse(fs.readFileSync(o.outFile, 'utf8'));
        return Array.isArray(j.snapshots) ? j.snapshots : [];
      } catch { return []; }
    };

    /* 每 500ms 看一眼：攒够批数就收工；或者通道集合连着两批没变、时间也够了，
       就不必再等下一批。 */
    const startedAt = Date.now();
    const idsOf = (snap) => ((snap && snap.providers) || []).map((p) => p.id).sort().join(',');
    const poll = setInterval(() => {
      const snaps = readSnapshots();
      if (snaps.length >= PROBE_MIN_SNAPSHOTS) { finish({ snapshots: snaps, stderr: stderrTail }); return; }
      if (snaps.length >= 3) {
        const a = idsOf(snaps[snaps.length - 1]);
        const b = idsOf(snaps[snaps.length - 2]);
        if (a && a === b && Date.now() - startedAt >= PROBE_SETTLE_MS) finish({ snapshots: snaps, stderr: stderrTail });
      }
    }, 500);
    const timer = setTimeout(() => finish({ snapshots: readSnapshots(), stderr: stderrTail }), PROBE_TIMEOUT_MS);
  });
}

/** 短命进程刚被杀时目录句柄可能还没松（Windows 常见），删不掉就隔会儿再删 */
function removeDirWithRetry(dir, tries) {
  const left = typeof tries === 'number' ? tries : 4;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch { /* 下面重试 */ }
  if (left <= 0) return;
  setTimeout(() => removeDirWithRetry(dir, left - 1), 500).unref?.();
}

async function probeOnce() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-chan-'));
  const home = path.join(dir, 'home');
  const outFile = path.join(dir, 'channels.json');
  const patchPath = path.join(dir, 'patch.yml');
  try {
    const seeded = seedHome(home);
    const plugins = materializeProviderPlugins();
    fs.writeFileSync(patchPath, buildProbePatch({ plugins, credentialsPath: seeded.credentialsPath, outFile }), 'utf8');
    const res = await runProbe({ dir, home, patchPath, outFile, cwd: dir });
    return { snapshots: res.snapshots, stderr: res.stderr, plugins, seedNote: seeded.note };
  } finally {
    removeDirWithRetry(dir);
  }
}

/* ------------------------------------------------------------
   3. 归一化成前端契约
   ------------------------------------------------------------ */

function effortOf(model) {
  const reasoning = model && model.reasoning;
  if (!reasoning || !Array.isArray(reasoning.efforts)) return { efforts: [], defaultEffort: null };
  const efforts = reasoning.efforts.map((e) => String((e && e.id) || '')).filter(Boolean);
  return { efforts, defaultEffort: reasoning.defaultEffort ? String(reasoning.defaultEffort) : null };
}

function labelOf(id, name) {
  if (LABELS[id]) return LABELS[id];
  return name && name !== id ? name : id;
}

function toModels(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const id = String((m && m.id) || '');
    if (!id) continue;
    const eff = effortOf(m);
    out.push({
      id,
      label: String((m && m.name) || id),
      ...(m && m.contextWindow ? { contextWindow: Number(m.contextWindow) } : {}),
      efforts: eff.efforts,
      defaultEffort: eff.defaultEffort,
    });
  }
  return out;
}

function officialComplete(provider, models) {
  if (models.length) return models;
  const fallback = OFFICIAL_MODELS[provider] || [];
  return fallback.map((id) => ({ id, label: id, efforts: [], defaultEffort: null }));
}

function normalize(snapshot) {
  const providers = [];
  for (const p of (snapshot && snapshot.providers) || []) {
    const id = String(p.id);
    if (id === 'our-free-model-sealed') continue;
    const isOfficial = id.indexOf('deepseek-') === 0;
    let models = toModels((snapshot.models || {})[id]);
    if (isOfficial) models = officialComplete(id, models);
    const apiKey = hasApiKey();
    const account = hasAccountCredentials();
    let available = models.length > 0;
    let note = '';
    if (isOfficial) {
      available = id === 'deepseek-official' ? apiKey : account;
      if (!available) {
        note = id === 'deepseek-official'
          ? '没有 DEEPSEEK_API_KEY：在项目根目录 .env 里填一行即可'
          : '没有桌面版登录态：先登录 DeepSeek Harness 桌面版';
      }
    } else if (!models.length) {
      note = '这个通道没有列出模型：多半是还没在桌面版里登录/授权该渠道';
    }
    providers.push({
      id,
      label: labelOf(id, p.name),
      kind: isOfficial ? 'official' : 'plugin',
      available,
      note,
      models,
    });
  }
  return providers;
}

export function channelLabel(provider) {
  return LABELS[provider] || provider || '';
}

/* ------------------------------------------------------------
   4. 缓存 + 对外接口
   ------------------------------------------------------------ */

let cache = null;          /* { at, providers, diagnostics, staleReason } */
let inflight = null;       /* 正在跑的那次枚举 */

function fallbackProviders(reason) {
  const apiKey = hasApiKey();
  const account = hasAccountCredentials();
  return [
    {
      id: 'deepseek-account',
      label: LABELS['deepseek-account'],
      kind: 'official',
      available: account,
      note: account ? '' : '没有桌面版登录态',
      models: OFFICIAL_MODELS['deepseek-account'].map((id) => ({ id, label: id, efforts: [], defaultEffort: null })),
    },
    {
      id: 'deepseek-official',
      label: LABELS['deepseek-official'],
      kind: 'official',
      available: apiKey,
      note: apiKey ? '' : '没有 DEEPSEEK_API_KEY',
      models: OFFICIAL_MODELS['deepseek-official'].map((id) => ({ id, label: id, efforts: [], defaultEffort: null })),
    },
  ].map((p) => (reason ? { ...p, note: p.note || reason } : p));
}

/** 当前默认通道：环境变量 WW_PROVIDER/WW_MODEL 优先，其次沿用身份路线 */
export function currentChannel() {
  const route = authRoute();
  const envProvider = String(process.env.WW_PROVIDER || '').trim();
  const envModel = String(process.env.WW_MODEL || '').trim();
  return {
    provider: envProvider || route.provider,
    model: envModel || 'deepseek-flash',
    reasoningEffort: null,
    source: envProvider ? 'env' : 'default',
  };
}

/** 缓存里的通道；没有缓存就返回 null */
export function cachedChannels() {
  return cache;
}

/**
 * 拿到"当前 DSH 接入的通道与模型"。
 * @param {object} o
 * @param {boolean} o.refresh 强制重新枚举
 * @param {number} o.waitMs  没缓存时最多等多久（到点先返回旧缓存/兜底）
 */
export async function listChannels(o) {
  const opts = o || {};
  if (!opts.refresh && cache && Date.now() - cache.at < TTL_MS) return cache;

  if (!inflight) {
    inflight = probeOnce()
      .then((res) => {
        const last = res.snapshots[res.snapshots.length - 1] || null;
        const providers = last ? normalize(last) : [];
        const diagnostics = [];
        if (res.seedNote) diagnostics.push(res.seedNote);
        if (!providers.length) diagnostics.push('DSH 没有报出任何通道' + (res.stderr ? '：' + tail(res.stderr) : ''));
        for (const p of providers) if (p.note) diagnostics.push(p.label + '：' + p.note);
        cache = {
          at: Date.now(),
          providers: providers.length ? providers : fallbackProviders(diagnostics[0] || ''),
          diagnostics,
          plugins: res.plugins.map((p) => p.package),
        };
        return cache;
      })
      .catch((e) => {
        cache = { at: Date.now(), providers: fallbackProviders(''), diagnostics: ['枚举通道失败：' + e.message] };
        return cache;
      })
      .finally(() => { inflight = null; });
  }

  const waitMs = typeof opts.waitMs === 'number' ? opts.waitMs : PROBE_TIMEOUT_MS + 2000;
  const raced = await Promise.race([
    inflight,
    new Promise((r) => setTimeout(() => r(null), Math.max(0, waitMs))),
  ]);
  if (raced) return raced;
  /* 还没跑完：先给旧的（或兜底），别让页面干等 */
  const fallback = cache || { at: Date.now(), providers: fallbackProviders(''), diagnostics: ['通道列表还在检测中…'] };
  return fallback;
}

/** 服务启动时后台预热，免得第一局开局前先等十几秒 */
export function warmChannels() {
  listChannels({ waitMs: 0 }).catch(() => { /* 预热失败不影响开局 */ });
}

/**
 * 校验玩家选的通道。给 index.mjs 用。
 * @returns {{ok:true, channel:object} | {ok:false, error:string}}
 */
export function resolveChannel(pick) {
  const req = pick || {};
  const provider = String(req.provider || '').trim();
  const model = String(req.model || '').trim();
  const effort = String(req.reasoningEffort || '').trim() || null;
  const list = (cache && cache.providers) || [];
  if (!provider) {
    const fallback = currentChannel();
    const known = list.find((p) => p.id === fallback.provider);
    if (known && !known.available) {
      return { ok: false, error: '默认通道「' + known.label + '」当前不可用：' + (known.note || '没有可用身份') };
    }
    return { ok: true, channel: fallback };
  }

  const known = list.find((p) => p.id === provider);
  if (!known) {
    const ids = list.map((p) => p.id).join('、') || '（还没检测出来）';
    return { ok: false, error: '通道「' + provider + '」不在当前 DSH 接入的列表里。可用：' + ids };
  }
  if (!known.available) {
    return { ok: false, error: '通道「' + known.label + '」当前不可用：' + (known.note || '没有可用身份') };
  }
  let chosen = model;
  if (!chosen) chosen = known.models.length ? known.models[0].id : '';
  if (!chosen) return { ok: false, error: '通道「' + known.label + '」没有可用模型' };

  const m = known.models.find((x) => x.id === chosen);
  if (!m && known.models.length) {
    const ids = known.models.slice(0, 12).map((x) => x.id).join('、');
    return { ok: false, error: '通道「' + known.label + '」没有模型「' + chosen + '」。可选：' + ids };
  }
  /* 模型没声明 reasoning 能力时一律不带这个字段，
     否则 DSH 会直接抛 does not support reasoning effort */
  let useEffort = null;
  if (effort && m && m.efforts && m.efforts.indexOf(effort) >= 0) useEffort = effort;
  return {
    ok: true,
    channel: {
      provider,
      model: chosen,
      reasoningEffort: useEffort,
      source: 'pick',
      /* 非官方渠道走的是各家自己的线上服务，实测比官方 flash 慢不少，
         所以回合超时要放宽（见 runtime.mjs）。 */
      plugin: known.kind !== 'official',
    },
  };
}

function tail(s) {
  const lines = String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const hit = lines.filter((x) => /error|invalid|unauthor|401|403|429|failed|refus/i.test(x));
  const pick = hit.length ? hit[hit.length - 1] : lines[lines.length - 1] || '';
  return pick.length > 240 ? pick.slice(0, 240) + '…' : pick;
}