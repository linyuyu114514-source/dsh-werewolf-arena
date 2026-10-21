/* 座位表：插件靠它把 sessionId 翻译成「几号玩家、什么身份」。
   每个座位一个 sessionId，session 就是信息隔离的物理边界——
   子代理只能看到我们主动发给它的东西。 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {object} o
 * @param {string} o.outFile
 * @param {string} o.matchId
 * 注意：座位表里**没有身份**。后端不知道谁是狼、谁是预言家，
 * 身份只存在于浏览器那一侧的规则引擎里，子代理的身份只出现在它自己的提示词里。
 * @param {Array<{seat:number,name:string}>} o.seats  不含用户自己的座位
 */
export function writeRoster(o) {
  const map = {};
  for (const s of o.seats) {
    map[o.matchId + ':' + s.seat] = {
      seat: s.seat,
      name: s.name,
    };
  }
  const body = {
    matchId: o.matchId,
    /* sessionId 规则：matchId:seat。插件用 sessionId 直接反查，不需要额外映射。 */
    seats: map,
  };
  fs.mkdirSync(path.dirname(o.outFile), { recursive: true });
  fs.writeFileSync(o.outFile, JSON.stringify(body, null, 2), 'utf8');
  return o.outFile;
}

export function sessionIdFor(matchId, seat) {
  return matchId + ':' + seat;
}
