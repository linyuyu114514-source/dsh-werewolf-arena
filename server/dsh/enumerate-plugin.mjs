/* DSH 枚举插件：把此刻注册在案的"通道"与"模型"画像写进一个 JSON 文件。

   谁用它：server/dsh/providers.mjs。它起一个短命 DSH 进程，patch 里挂上这个插件，
   等文件落地后读走、关进程。整个过程只查目录，不打模型，不花 token。

   为什么要分批写好几次：第三方渠道插件是异步把自己那几条路由挂上来的，
   进程刚起来时读到的往往是空表——只写一次会稳定地漏掉它们。

   文件结构：{ snapshots: [ { tag, at, providers:[{id,name}], models:{ [provider]: [模型画像] }, error? } ] } */
import fs from 'node:fs';

export const name = 'ww-enumerate';

/** 把模型画像裁成可 JSON 化的形状：去掉函数、限深、限长 */
function safe(value, depth) {
  const d = depth || 0;
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function') return undefined;
  if (d >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 600).map((v) => safe(v, d + 1));
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = safe(value[k], d + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return undefined;
}

export function apply(ctx, config) {
  const outFile = (config && config.out) || 'channels.json';
  const delays = [1200, 3500, 7000, 12000, 18000];
  const snapshots = [];

  function flush() {
    try {
      fs.writeFileSync(outFile, JSON.stringify({ snapshots }, null, 2), 'utf8');
    } catch { /* 写不进去父进程会超时，超时那边有兜底 */ }
  }

  async function probe(tag) {
    const llm = ctx.get('llm');
    const snap = { tag, at: Date.now(), providers: [], models: {} };
    if (!llm) {
      snap.error = 'llm 服务没有起来';
      snapshots.push(snap);
      flush();
      return;
    }
    let list = [];
    try {
      list = await llm.listProviders();
    } catch (e) {
      snap.error = String((e && e.message) || e);
    }
    for (const p of Array.isArray(list) ? list : []) {
      const id = typeof p === 'string' ? p : String((p && p.id) || '');
      if (!id) continue;
      snap.providers.push({ id, name: String((p && p.name) || id) });
    }
    for (const p of snap.providers) {
      try {
        const models = await llm.listModels(p.id);
        snap.models[p.id] = (Array.isArray(models) ? models : []).map((m) => safe(m, 0));
      } catch (e) {
        snap.models[p.id] = [];
        snap.errors = snap.errors || {};
        snap.errors[p.id] = String((e && e.message) || e);
      }
    }
    snapshots.push(snap);
    flush();
  }

  for (let i = 0; i < delays.length; i += 1) {
    setTimeout(() => { void probe('t' + i); }, delays[i]);
  }
}