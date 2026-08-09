/* ===== 自动理牌: 用最少出牌次数拆分整手牌 =====
 * 牌型: 单张/对子/三张/三带二/连对/钢板/顺子/同花顺/炸弹
 * 思路: 枚举候选牌型 → 按"性价比"贪心 + 有限回溯搜最少手数
 * 输出: [{cards:[...], e:{type,...}}, ...] 顺序即建议出牌顺序(小→大)
 */

/* 把手牌按点数分组(排除逢人配,它当万能牌单独处理) */
function _groupByVal(hand, level) {
  const wilds = hand.filter(c => isWild(c, level));
  const norm = hand.filter(c => !isWild(c, level));
  const byVal = {};
  norm.forEach(c => { const v = cmpVal(c, level); (byVal[v] = byVal[v] || []).push(c); });
  return { wilds, norm, byVal };
}

/* 枚举全部候选牌型(不含逢人配的复杂替代,逢人配优先补成炸弹/三张) */
function arrangeCandidates(hand, level) {
  const out = [];
  const { wilds, norm, byVal } = _groupByVal(hand, level);
  const vals = Object.keys(byVal).map(Number).sort((a, b) => a - b);
  const seen = new Set();
  const push = (cards) => {
    if (!cards.length) return;
    const key = cards.map(c => c.id).sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    const e = evalCards(cards, level);
    if (!e) return;
    seen.add(key);
    out.push({ cards: cards.slice(), e });
  };

  // 同点数: 单/对/三/炸(4张以上)
  vals.forEach(v => {
    const g = byVal[v];
    for (let k = 1; k <= g.length; k++) push(g.slice(0, k));
    // 逢人配补足: 补成对/三/炸
    for (let w = 1; w <= wilds.length; w++) {
      for (let k = 1; k <= g.length; k++) {
        if (k + w > 6) continue;
        push(g.slice(0, k).concat(wilds.slice(0, w)));
      }
    }
  });
  // 逢人配单出
  wilds.forEach(c => push([c]));
  // 王炸 / 王单出已由上面同点数分组覆盖(JOKER 也在 byVal 中)

  // 三带二
  vals.forEach(v3 => {
    if (byVal[v3].length < 3) return;
    vals.forEach(v2 => {
      if (v2 === v3 || byVal[v2].length < 2) return;
      push(byVal[v3].slice(0, 3).concat(byVal[v2].slice(0, 2)));
    });
  });

  // 连续型: 顺子(5张)/连对(3对)/钢板(2个三张)
  const seqVals = vals.filter(v => v <= 14);            // 大小王不参与顺子
  const hasVal = v => byVal[v] && byVal[v].length > 0;
  seqVals.forEach(start => {
    // 顺子: 连续5个不同点数
    let ok = true;
    for (let i = 0; i < 5; i++) if (!hasVal(start + i)) { ok = false; break; }
    if (ok && start + 4 <= 14) {
      const pick = [];
      for (let i = 0; i < 5; i++) pick.push(byVal[start + i][0]);
      push(pick);
      // 同花顺: 同花色的连续5张
      SUITS.forEach(s => {
        const sp = [];
        for (let i = 0; i < 5; i++) {
          const c = (byVal[start + i] || []).find(x => x.s === s && !isJoker(x));
          if (c) sp.push(c);
        }
        if (sp.length === 5) push(sp);
      });
    }
    // 连对: 连续3个点数各出一对
    let ok2 = true;
    for (let i = 0; i < 3; i++) if (!(byVal[start + i] && byVal[start + i].length >= 2)) { ok2 = false; break; }
    if (ok2 && start + 2 <= 14) {
      const pick = [];
      for (let i = 0; i < 3; i++) pick.push(...byVal[start + i].slice(0, 2));
      push(pick);
    }
    // 钢板: 连续2个点数各出三张
    let ok3 = true;
    for (let i = 0; i < 2; i++) if (!(byVal[start + i] && byVal[start + i].length >= 3)) { ok3 = false; break; }
    if (ok3 && start + 1 <= 14) {
      const pick = [];
      for (let i = 0; i < 2; i++) pick.push(...byVal[start + i].slice(0, 3));
      push(pick);
    }
  });

  return out;
}

/* 最少手数拆分: 贪心为主 + 有限回溯
 * 评分: 优先用牌多的组合(减少手数),同分优先保留炸弹不拆
 */
function arrangeHand(hand, level, opt) {
  opt = opt || {};
  const budget = opt.budget || 24000;        // 搜索步数上限,防卡死
  const branch = opt.branch || 14;           // 每层分支上限
  const cands = arrangeCandidates(hand, level);
  // 大组合优先; 同长度时炸弹/同花顺排后面(尽量保留,除非能减手数)
  cands.sort((a, b) => {
    if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length;
    const ab = a.e.type === 'bomb' ? 1 : 0, bb = b.e.type === 'bomb' ? 1 : 0;
    return ab - bb;
  });

  let best = null, steps = 0;
  const total = hand.length;

  const dfs = (remain, picked) => {
    if (steps++ > budget) return;
    if (!remain.size) {
      if (!best || picked.length < best.length) best = picked.slice();
      return;
    }
    // 剪枝: 当前手数 + 剩余牌最少需要的手数(每手最多按最大候选长度算) >= best
    if (best) {
      const maxLen = 6;
      if (picked.length + Math.ceil(remain.size / maxLen) >= best.length) return;
    }
    // 只考虑"包含剩余牌中某一张固定牌"的组合,避免重复搜索同一集合
    const anchor = remain.values().next().value;
    let tried = 0;
    for (const cd of cands) {
      if (!cd.cards.some(c => c.id === anchor)) continue;
      if (!cd.cards.every(c => remain.has(c.id))) continue;
      const nr = new Set(remain);
      cd.cards.forEach(c => nr.delete(c.id));
      picked.push(cd);
      dfs(nr, picked);
      picked.pop();
      if (++tried >= branch) break;         // 每层分支上限,控制规模
      if (steps > budget) return;
    }
  };

  dfs(new Set(hand.map(c => c.id)), []);

  // 兜底: 搜索失败/超预算 → 贪心一遍
  if (!best) {
    best = [];
    const remain = new Set(hand.map(c => c.id));
    while (remain.size) {
      const cd = cands.find(x => x.cards.every(c => remain.has(c.id)));
      if (!cd) {
        // 剩下的按单张出
        hand.filter(c => remain.has(c.id)).forEach(c => {
          best.push({ cards: [c], e: evalCards([c], level) });
          remain.delete(c.id);
        });
        break;
      }
      cd.cards.forEach(c => remain.delete(c.id));
      best.push(cd);
    }
  }

  // 建议出牌顺序: 小的先出(炸弹留最后)
  best.sort((a, b) => {
    const ab = a.e.type === 'bomb' ? 1 : 0, bb = b.e.type === 'bomb' ? 1 : 0;
    if (ab !== bb) return ab - bb;
    return (a.e.val || 0) - (b.e.val || 0);
  });
  return { hands: best, count: best.length, total, steps };
}
