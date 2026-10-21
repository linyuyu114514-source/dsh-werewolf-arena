/* 读项目根目录的 .env / .env.local，注入 process.env。
   必须在其它模块之前 import：paths.mjs 在模块加载时就会读 DEEPSEEK_API_KEY。
   换机器时只要把 DEEPSEEK_API_KEY 写进 .env，就不用动代码。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(HERE, '..');

/** 极简 dotenv：支持 # 注释、export 前缀、单双引号 */
function parse(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let k = line.slice(0, eq).trim();
    if (k.slice(0, 7) === 'export ') k = k.slice(7).trim();
    let v = line.slice(eq + 1).trim();
    const q = v.charAt(0);
    if ((q === '"' || q === "'") && v.charAt(v.length - 1) === q && v.length >= 2) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}

/** 这一轮从 .env 里真正补进来的键（用于健康检查展示） */
export const envFromFile = [];

for (const name of ['.env', '.env.local']) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(ROOT_DIR, name), 'utf8');
  } catch {
    continue;
  }
  const kv = parse(text);
  for (const k of Object.keys(kv)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = kv[k];
      if (envFromFile.indexOf(k) < 0) envFromFile.push(k);
    }
  }
}
