/* 临时 DSH_HOME 的播种。

   一局游戏跑在一个临时 DSH_HOME 里，局末整目录删掉，磁盘零残留。
   但"非官方通道"的登录态是玩家平时在桌面版里攒下来的，存在真实的
   %USERPROFILE%\.dsh 下——临时目录里当然没有，直接开一局会变成"没登录"。

   所以开局（以及枚举通道）之前，把只读的那几样复制一份进临时目录：

     .credentials.yaml   凭据（复制而不是指原文件：免得游戏进程回写到桌面版状态）
     channel-pack/       渠道的授权与签到台账
     our-free-model/     免费通道的设置与目录缓存

   复制是尽力而为：一样都没有也不报错，对应通道不可用时自然会在
   对局里如实报错，而不是让整个游戏起不来。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DSH_USER_HOME } from './paths.mjs';

/* 没有凭据文件时也要让 credentials 服务正常起来，
   这样 API Key 才能从进程环境/.env 里回退解析出来。 */
const EMPTY_CREDENTIALS = 'version: 1\nrecords: {}\nrefs: {}\n';

/* 从真实 DSH_HOME 里搬哪些目录（整目录、只搬文件） */
const DIRS = ['channel-pack', 'our-free-model'];

function copyDir(src, dest) {
  let names = [];
  try { names = fs.readdirSync(src, { withFileTypes: true }); } catch { return false; }
  try { fs.mkdirSync(dest, { recursive: true }); } catch { return false; }
  let any = false;
  for (const e of names) {
    if (!e.isFile()) continue;
    try {
      fs.copyFileSync(path.join(src, e.name), path.join(dest, e.name));
      any = true;
    } catch { /* 单个文件复制失败不影响其它 */ }
  }
  return any;
}

/* 我们自己在系统临时目录里开的东西，前缀都在这张表里 */
const OUR_TEMP_PREFIXES = ['ww-dsh-', 'ww-chan-', 'ww-provider-plugins'];

/**
 * 清扫陈旧残留：窗口被硬关（进程直接被杀）时 bye() 来不及删临时目录，
 * 所以每次起服务顺手把"明显是上一局留下的"清掉。
 * 只动我们自己前缀的目录，且只动 6 小时以前的——正在跑的局不会被误删。
 * @param {number} [olderThanMs] 默认 6 小时
 * @returns {string[]} 清掉的目录名
 */
export function sweepStaleTemp(olderThanMs) {
  const limit = typeof olderThanMs === 'number' ? olderThanMs : 6 * 60 * 60 * 1000;
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(os.tmpdir(), { withFileTypes: true }); } catch { return removed; }
  for (const e of names) {
    const hit = OUR_TEMP_PREFIXES.some((p) => e.name.indexOf(p) === 0);
    if (!hit) continue;
    const full = path.join(os.tmpdir(), e.name);
    try {
      const st = fs.statSync(full);
      if (Date.now() - st.mtimeMs < limit) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(e.name);
    } catch { /* 删不掉就算了，不影响服务 */ }
  }
  return removed;
}

/**
 * 把真实 DSH_HOME 里的只读状态播种到临时 DSH_HOME。
 * @param {string} tempHome 临时 DSH_HOME（会被创建）
 * @returns {{credentialsPath:string, copied:string[], note:string}}
 */
export function seedHome(tempHome) {
  fs.mkdirSync(tempHome, { recursive: true });
  const copied = [];
  const note = [];
  const credOut = path.join(tempHome, '.credentials.yaml');

  let credIn = '';
  try {
    const real = path.join(DSH_USER_HOME, '.credentials.yaml');
    if (fs.existsSync(real)) {
      fs.copyFileSync(real, credOut);
      copied.push('.credentials.yaml');
      credIn = real;
    }
  } catch { /* 下面回退成空凭据 */ }
  if (!credIn) {
    if (!fs.existsSync(credOut)) fs.writeFileSync(credOut, EMPTY_CREDENTIALS, 'utf8');
    note.push('没有找到桌面版凭据文件，非官方通道可能报未登录');
  }

  for (const dir of DIRS) {
    const src = path.join(DSH_USER_HOME, dir);
    if (!fs.existsSync(src)) continue;
    if (copyDir(src, path.join(tempHome, dir))) copied.push(dir);
  }

  return { credentialsPath: credOut, copied, note: note.join('；') };
}