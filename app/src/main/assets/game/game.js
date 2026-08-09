
/* ===== 掼蛋主控 =====
 * 座位: 0=我(下) 1=右家(下家) 2=对家(上) 3=左家(上家)
 * 队伍: 0&2 = 我方,  1&3 = 对方
 * 出牌顺序: 0 -> 1 -> 2 -> 3 -> 0
 */
const SEAT_KEY = ['S','E','N','W'];
const SEAT_NAME = ['我','右家','对家','左家'];
const LEVELS = RANKS;                       // '2'..'A'

const G = {
  hands: [[], [], [], []],
  turn: 0,
  lastPlay: null,        // {seat, cards, e}
  finished: [],          // 出完牌的座位顺序
  curLevel: '2',         // 本局级牌
  usLevel: '2',
  themLevel: '2',
  round: 1,
  running: false,
  sel: new Set(),        // 选中的牌 id
  hintList: [],
  hintIdx: 0,
  aiTimer: null,
  passed: [false, false, false, false],   // 本轮谁说了"不要"(新一轮清空)
  turnTimer: null,
  turnLeft: 0,
};

const $ = id => document.getElementById(id);
const teamOf = s => (s % 2 === 0) ? 0 : 1;   // 0=我方 1=对方

/* ---------- 渲染: 单张牌 ---------- */
function cardEl(c, opt) {
  opt = opt || {};
  const d = document.createElement('div');
  // 四色牌: 红桃红 / 黑桃黑 / 方块黄 / 梅花绿; 大王红 小王黑
  const SUIT_CLS = { H: 'sH', S: 'sS', D: 'sD', C: 'sC' };
  d.className = 'card ' + (isJoker(c)
    ? (c.r === 'JOKER_B' ? 'sH' : 'sS')
    : SUIT_CLS[c.s]);
  if (isJoker(c)) d.classList.add('joker');
  if (c.r === G.curLevel && !isJoker(c)) d.classList.add('lvl');
  if (G.sel.has(c.id)) d.classList.add('sel');
  d.dataset.id = c.id;                        // 滑动选牌用: 从DOM反查牌

  const r = document.createElement('div'); r.className = 'r';
  const s = document.createElement('div'); s.className = 's';
  const b = document.createElement('div'); b.className = 'big';

  if (isJoker(c)) {
    r.textContent = c.r === 'JOKER_B' ? '大王' : '小王';
    s.textContent = '';
    b.textContent = '🃏';
  } else {
    r.textContent = c.r;
    s.textContent = SUIT_CH[c.s];
    b.textContent = SUIT_CH[c.s];
  }
  d.appendChild(r); d.appendChild(s); d.appendChild(b);

  if (opt.click) {
    d.addEventListener('click', () => opt.click(c));
  }
  return d;
}

/* ---------- 渲染: 手牌 ---------- */
/* ---------- 滑动选牌 ----------
 * 同列上下滑 / 跨列左右滑,经过的牌统一设为"选中"或"取消"
 * (以起始牌的原状态取反为准,滑过的牌全部跟随,微信/欢乐掼蛋的手感)
 * 滑动期间只改 class 不重渲染 —— 否则手指下的 DOM 会被替换掉
 */
function initSwipeSelect() {
  const box = $('hand');
  if (!box || box.__swipeBound) return;
  box.__swipeBound = true;

  let dragging = false, mode = true, startId = null, moved = 0, sx = 0, sy = 0;

  const cardAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('#hand .card') : null;
  };
  const apply = (el) => {
    if (!el || el.dataset.id === undefined) return;
    const id = Number(el.dataset.id);      // dataset 是字符串,牌 id 是数字,必须转回来
    if (mode) { G.sel.add(id); el.classList.add('sel'); }
    else { G.sel.delete(id); el.classList.remove('sel'); }
  };

  box.addEventListener('pointerdown', ev => {
    if (!G.running || G.turn !== 0) return;
    const el = cardAt(ev.clientX, ev.clientY);
    if (!el) return;
    dragging = true; moved = 0;
    sx = ev.clientX; sy = ev.clientY;
    startId = Number(el.dataset.id);
    mode = !G.sel.has(startId);            // 起始牌未选中 → 本次为"选中"模式
    apply(el);
    updateBar();
  });

  box.addEventListener('pointermove', ev => {
    if (!dragging) return;
    moved = Math.max(moved, Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy));
    if (moved < 6) return;                 // 抖动容差,避免误判成滑动
    ev.preventDefault();
    apply(cardAt(ev.clientX, ev.clientY));
    updateBar();
  }, { passive: false });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    // 真正滑动过 → 抑制随后的 click(否则 toggleSel 会把刚选的牌再翻转)
    box.__suppressClick = moved >= 6;
    G.hintList = [];
    renderHand();                          // 松手后统一重渲染(应用展开效果)
    updateBar();
  };
  box.addEventListener('pointerup', finish);
  box.addEventListener('pointercancel', finish);
  // 注意: 不绑 pointerleave —— 手指滑出手牌区边缘会误判为结束
}

function renderHand() {
  const box = $('hand');
  initSwipeSelect();                   // 绑定滑动选牌(内部保证只绑一次)
  box.innerHTML = '';
  const h = G.hands[0];
  if (!h.length) return;

  // 按点数分组: 同点数的牌竖向堆成一列
  const groups = [];
  const idx = {};
  h.forEach(c => {
    const key = c.r;                             // 点数为准,花色不分列
    if (idx[key] === undefined) { idx[key] = groups.length; groups.push({ key, cards: [] }); }
    groups[idx[key]].cards.push(c);
  });

  // 牌尺寸从 CSS 读取(媒体查询会改小),避免 JS/CSS 不一致
  const probe = document.createElement('div');
  probe.className = 'card';
  probe.style.visibility = 'hidden';
  box.appendChild(probe);
  const pr = probe.getBoundingClientRect();
  const CARD_W = Math.round(pr.width) || 36, CARD_H = Math.round(pr.height) || 52;
  box.removeChild(probe);

  const nCol = groups.length;
  const avail = ($('table').clientWidth || window.innerWidth) - 8;
  const maxStack = Math.max(...groups.map(g => g.cards.length));

  // 列宽 = 牌宽(竖堆不占额外横向空间); 列间距按可用宽度反算
  let gap = 6;
  const totalNeed = () => nCol * CARD_W + gap * (nCol - 1);
  let colOverlap = 0;
  if (totalNeed() > avail) {
    while (gap > 1 && totalNeed() > avail) gap--;
    if (totalNeed() > avail && nCol > 1) {
      colOverlap = Math.ceil((totalNeed() - avail) / (nCol - 1));
    }
  }

  // 列内竖向错位: 让每张都露出顶部点数区,受手牌区高度约束
  const boxH = box.clientHeight || 150;
  let upStep = 22;                                        // 每张向上错开
  if (maxStack > 1) {
    const fit = Math.floor((boxH - CARD_H) / (maxStack - 1));
    if (fit < upStep) upStep = Math.max(13, fit);         // 下限13px:保证点数可见
  }
  // 选中列展开: 按"该列自身张数"反算可用间距(短列空间更大),至少比常态多3px
  const expandStep = (n) => {
    if (n <= 1) return upStep;
    const fit = Math.floor((boxH - CARD_H) / (n - 1));
    const want = upStep + 10;                             // 期望拉开10px
    return Math.max(upStep + 3, Math.min(want, Math.max(fit, upStep + 3)));
  };
  box.style.transform = 'translateX(-50%)';

  groups.forEach((g, ci) => {
    const col = document.createElement('div');
    col.className = 'hcol';
    // 该列有牌被选中 → 整列均匀展开
    const colSel = g.cards.some(c => G.sel.has(c.id));
    const step = colSel ? expandStep(g.cards.length) : upStep;
    if (colSel) col.classList.add('expanded');
    col.style.width = CARD_W + 'px';
    col.style.height = (CARD_H + (g.cards.length - 1) * step) + 'px';
    col.style.marginLeft = (ci === 0 ? 0 : (gap - colOverlap)) + 'px';

    g.cards.forEach((c, ri) => {
      const el = cardEl(c, { click: toggleSel });
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.bottom = (ri * step) + 'px';       // 向上堆叠(选中列间距更大)
      el.style.marginLeft = '0';
      el.style.zIndex = String(10 + (g.cards.length - 1 - ri));  // 靠下的牌在更上层,露出自己顶部点数
      col.appendChild(el);
    });

    // 双击列 = 整列同点数一起选/取消(照顾被压住的牌)
    col.addEventListener('dblclick', ev => {
      ev.preventDefault();
      if (!G.running || G.turn !== 0) return;
      const allSel = g.cards.every(c => G.sel.has(c.id));
      g.cards.forEach(c => { if (allSel) G.sel.delete(c.id); else G.sel.add(c.id); });
      G.hintList = [];
      renderHand(); updateBar();
    });
    box.appendChild(col);
  });
}

function toggleSel(c) {
  if (!G.running || G.turn !== 0) return;
  const box = $('hand');
  // pointerdown 已处理选中(滑动机制);滑动后抑制这次 click 避免翻转两次
  if (box && box.__suppressClick) { box.__suppressClick = false; return; }
  if (box && box.__swipeBound) return;      // 交给滑动逻辑,不重复翻转
  if (G.sel.has(c.id)) G.sel.delete(c.id); else G.sel.add(c.id);
  G.hintList = [];
  renderHand();
  updateBar();
}

/* ---------- 渲染: 对手牌背 + 张数 ---------- */
function renderSeats() {
  for (let s = 1; s <= 3; s++) {
    const k = SEAT_KEY[s];
    const n = G.hands[s].length;
    // 牌数只在 <10 张时才显示(快走完了才提示),平时不暴露信息
    const cntEl = $('c' + k);
    const cntBox = cntEl ? cntEl.parentNode : null;
    if (cntEl) cntEl.textContent = n;
    if (cntBox) cntBox.style.visibility = (n > 0 && n < 10) ? 'visible' : 'hidden';
    const seat = $('seat' + k);
    seat.style.opacity = n === 0 ? .45 : 1;
    // 持久"不要"标记: 出完牌的人不显示
    const tag = $('p' + k);
    if (tag) tag.classList.toggle('on', !!G.passed[s] && n > 0);
  }
  // 我自己的"不要"标记
  const myTag = $('pS');
  if (myTag) myTag.classList.toggle('on', !!G.passed[0] && G.hands[0].length > 0);
  $('hLevel').textContent = G.curLevel;
  $('hUs').textContent = G.usLevel;
  $('hThem').textContent = G.themLevel;
  $('hRound').textContent = G.round;
}

/* ---------- 渲染: 各家出牌区 ----------
 * 谁出的牌显示在谁的方位: 对家在其下方,左家在右侧,右家在左侧,我在上方
 * 只显示当前这一手(G.lastPlay),不遮挡中央提示区
 */
function renderCenter() {
  ['zN', 'zW', 'zE', 'zS'].forEach(id => {
    const z = $(id);
    if (z) { z.innerHTML = ''; z.classList.remove('on'); }
  });
  $('centerCards').innerHTML = '';
  if (!G.lastPlay) {
    $('centerTip').textContent = G.running
      ? (SEAT_NAME[G.turn] + ' 出牌') : '点「开始」发牌';
    return;
  }
  const zid = 'z' + SEAT_KEY[G.lastPlay.seat];
  const box = $(zid) || $('centerCards');
  box.classList.add('on');
  G.lastPlay.cards.forEach((c, i) => {
    const el = cardEl(c);
    el.classList.add('mini');
    if (i > 0) el.style.marginLeft = '-18px';
    box.appendChild(el);
  });
  $('centerTip').textContent =
    SEAT_NAME[G.lastPlay.seat] + ' · ' + typeName(G.lastPlay.e);
}

/* ---------- 飘字 ---------- */
function toast(text, seat, bomb) {
  const el = document.createElement('div');
  el.className = 'float' + (bomb ? ' bomb' : '');
  el.textContent = text;
  const pos = { 0: ['50%', '68%'], 1: ['80%', '42%'], 2: ['50%', '20%'], 3: ['20%', '42%'] };
  const p = pos[seat === undefined ? 0 : seat];
  el.style.left = p[0]; el.style.top = p[1];
  $('table').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ---------- 按钮状态 ---------- */
/* ---------- 出牌限时(仅人类座位0) ---------- */
const TURN_LIMIT = 10;                            // 跟牌: 10秒
const LEAD_LIMIT = 20;                            // 首出(领出)要规划整手,给20秒

function clearTurnTimer() {
  clearInterval(G.turnTimer);
  G.turnTimer = null;
  G.turnLeft = 0;
  const el = $('hTimer'), chip = $('hTimerChip');
  if (el) el.textContent = '--';
  if (chip) chip.classList.remove('urgent');
}

function startTurnTimer() {
  clearTurnTimer();
  if (!G.running || G.turn !== 0) return;
  // 弹窗打开时(逢人配/结算)不计时,避免玩家被强制打断
  if ($('wildPick').classList.contains('on') || $('mask').classList.contains('on')) return;
  // 领出(桌面无牌可跟)需要规划整手 → 20秒; 跟牌 → 10秒
  G.turnLeft = G.lastPlay ? TURN_LIMIT : LEAD_LIMIT;
  const el = $('hTimer'), chip = $('hTimerChip');
  if (el) el.textContent = G.turnLeft;
  G.turnTimer = setInterval(() => {
    G.turnLeft--;
    if (el) el.textContent = G.turnLeft;
    if (chip) chip.classList.toggle('urgent', G.turnLeft <= 3);
    if (G.turnLeft <= 0) {
      clearTurnTimer();
      autoPlayTimeout();
    }
  }, 1000);
}

/* 超时自动出牌: 取手牌区最右边那一列(点数最大的同点数组)
 * 若该列打不过上家,则退而找任一能打过的最小组合; 都不行则过牌 */
function autoPlayTimeout() {
  if (!G.running || G.turn !== 0) return;
  const prev = G.lastPlay ? G.lastPlay.e : null;

  // 最右列 = 手牌末尾那个点数的全部牌
  const h = G.hands[0];
  if (!h.length) return;
  const lastRank = h[h.length - 1].r;
  const rightMost = h.filter(c => c.r === lastRank);

  // 依次尝试: 整列 → 列的子集(从大到小张数)
  for (let n = rightMost.length; n >= 1; n--) {
    const cards = rightMost.slice(rightMost.length - n);
    const opts = cards.some(c => isWild(c, G.curLevel))
      ? wildOptions(cards, G.curLevel).filter(o => beats(o.e, prev))
      : (() => { const e = evalCards(cards, G.curLevel); return (e && beats(e, prev)) ? [{ e }] : []; })();
    if (opts.length) {
      toast('超时·自动出牌', 0);
      return doPlay(0, cards, opts[0].e);
    }
  }

  // 最右列不合法 → 找能打过的最小组合
  const legal = genCombos(h, G.curLevel).filter(o => beats(o.e, prev));
  if (legal.length) {
    legal.sort((a, b) => a.e.val - b.e.val);
    toast('超时·自动出牌', 0);
    return doPlay(0, legal[0].cards, legal[0].e);
  }
  // 实在打不过 → 过牌
  if (G.lastPlay) { toast('超时·自动过牌', 0); return doPass(0); }
}

function updateBar() {
  const my = G.running && G.turn === 0;
  $('btnPlay').disabled = !my || G.sel.size === 0;
  $('btnPass').disabled = !my || !G.lastPlay;
  $('btnHint').disabled = !my;
}

function refresh() {
  renderHand(); renderSeats(); renderCenter(); updateBar();
  if ($('counter').classList.contains('on')) renderCounter();
}

/* ---------- 发牌 ---------- */
function deal() {
  const deck = shuffle(makeDeck());
  for (let s = 0; s < 4; s++) G.hands[s] = sortHand(deck.slice(s * 27, s * 27 + 27), G.curLevel);
  G.turn = 0;
  G.lastPlay = null;
  G.finished = [];
  G.sel.clear();
  G.hintList = [];
  G.running = true;
  G.ending = false;
  G.played = [];               // 记牌器: 本局已出的所有牌
  clearPassed();               // 新局清"不要"标记
  refresh();

  // 上一局有排名 → 走进贡/还贡流程
  if (G.lastOrder && G.lastOrder.length === 4) {
    doTribute(G.lastOrder);
  } else {
    G.turn = 0;
    refresh();
    toast('开始 · 打 ' + G.curLevel, 0);
    startTurnTimer();            // 首出是我 → 起表
  }
}

/* ---------- 进贡 / 还贡 ---------- */
function doTribute(order) {
  const first = order[0], second = order[1], third = order[2], last = order[3];
  const doubleDown = teamOf(order[0]) === teamOf(order[1]);   // 头游+二游同队 = 双下
  // 双下: 三游和末游都进贡; 否则只有末游进贡
  const givers = doubleDown ? [third, last] : [last];
  const logs = [];

  // 抗贡判定
  const refusers = givers.filter(s => canRefuse(G.hands[s]));
  if (refusers.length === givers.length && givers.length > 0) {
    G.turn = last;                       // 抗贡成功,末游先出
    refresh();
    showDlg('抗贡!', givers.map(s => SEAT_NAME[s]).join('、') +
      ' 手握双大王,免于进贡<br><br>由 <b>' + SEAT_NAME[last] + '</b> 先出',
      '开始', () => { toast('抗贡 · 打 ' + G.curLevel, last); if (G.turn !== 0) scheduleAi(); });
    return;
  }

  // 进贡: 收贡方按名次,头游先收
  const receivers = doubleDown ? [first, second] : [first];
  const pairs = [];
  givers.forEach((g, i) => {
    if (canRefuse(G.hands[g])) { logs.push(SEAT_NAME[g] + ' 抗贡'); return; }
    const r = receivers[i] !== undefined ? receivers[i] : receivers[0];
    const card = tributeCard(G.hands[g], G.curLevel);
    moveCard(G.hands[g], G.hands[r], card);
    logs.push(SEAT_NAME[g] + ' → ' + SEAT_NAME[r] + ' 进贡 ' + cardText(card));
    pairs.push([r, g]);
  });

  // 还贡: 收贡方还一张 ≤10 给进贡方
  pairs.forEach(([r, g]) => {
    const card = backCard(G.hands[r], G.curLevel);
    moveCard(G.hands[r], G.hands[g], card);
    logs.push(SEAT_NAME[r] + ' → ' + SEAT_NAME[g] + ' 还贡 ' + cardText(card));
  });

  for (let s = 0; s < 4; s++) G.hands[s] = sortHand(G.hands[s], G.curLevel);

  // 进贡方先出(标准规则: 上贡最大者先出); 全抗贡则末游先出
  G.turn = pairs.length ? pairs[0][1] : last;
  refresh();
  showDlg('进贡 / 还贡', logs.join('<br>') +
    '<br><br>由 <b>' + SEAT_NAME[G.turn] + '</b> 先出',
    '开始', () => {
      toast('打 ' + G.curLevel, G.turn);
      if (G.turn !== 0) scheduleAi();
      else startTurnTimer();          // 我先出 → 起表
    });
}

function cardText(c) {
  if (isJoker(c)) return c.r === 'JOKER_B' ? '大王' : '小王';
  return SUIT_CH[c.s] + c.r;
}

function scheduleAi() {
  clearTimeout(G.aiTimer);
  G.aiTimer = setTimeout(aiTurn, 620 + Math.random() * 420);
}

/* ---------- 座位轮转 ---------- */
function nextSeat(s) {
  for (let i = 1; i <= 4; i++) {
    const n = (s + i) % 4;
    if (G.hands[n].length > 0) return n;
  }
  return -1;
}

function activeCount() { return G.hands.filter(h => h.length > 0).length; }

/* ---------- 出牌 ---------- */
function doPlay(seat, cards, e) {
  if (seat === 0) clearTurnTimer();               // 我出牌了,立刻停表
  clearPassed();                                  // 有人出牌 → 清掉上一圈的"不要"标记
  // 从手牌移除
  const ids = new Set(cards.map(c => c.id));
  G.hands[seat] = G.hands[seat].filter(c => !ids.has(c.id));
  G.played = (G.played || []).concat(cards);      // 记牌器累计
  G.lastPlay = { seat, cards, e };
  const bomb = e.type === 'bomb';
  toast(typeName(e) + (bomb ? '!' : ''), seat, bomb);
  voicePlay(e, cards, G.curLevel);                // 语音报牌型

  if (G.hands[seat].length === 0) {
    G.finished.push(seat);
    const rank = G.finished.length;
    const tag = ['头游', '二游', '三游', '末游'][rank - 1];
    setTimeout(() => toast(SEAT_NAME[seat] + ' ' + tag, seat), 420);
  }
  refresh();
  advance();
}

function doPass(seat) {
  if (seat === 0) clearTurnTimer();               // 我过牌了,立刻停表
  G.passed[seat] = true;                          // 持久标记"不要",直到新一轮
  toast('不要', seat);
  voicePass();                                    // 语音报"不要"
  refresh();
  advance();
}

/* ---------- 推进回合 ---------- */
function clearPassed() { G.passed = [false, false, false, false]; }

function advance() {
  // 局终判定: 只剩1家 或 一方双下 —— 必须原子,立刻停止接受新动作
  if (activeCount() <= 1) {
    if (G.ending) return;          // 防重入(快速连点/异步竞态)
    G.ending = true;
    G.running = false;             // 立刻封盘,不等 endRound 的定时器
    clearTurnTimer();              // 局终停表
    if (activeCount() === 1) {
      const last = G.hands.findIndex(h => h.length > 0);
      if (G.finished.indexOf(last) < 0) G.finished.push(last);
    }
    clearTimeout(G.aiTimer);
    updateBar();
    return setTimeout(endRound, 700);
  }

  let nxt = nextSeat(G.turn);
  // 一圈回到领出者 → 本轮结束,清桌重新领出
  if (G.lastPlay && nxt === G.lastPlay.seat) {
    G.lastPlay = null;
    clearPassed();                     // 新一轮 → 清"不要"标记
    G.turn = nxt;
    refresh();
    toast('新一轮', nxt);
  } else if (G.lastPlay && G.hands[G.lastPlay.seat].length === 0) {
    // 领出者已出完牌: 其余各家都不要时 → 接风(牌权归其队友)
    const owner = G.lastPlay.seat;
    let passedOwner = false;
    for (let i = 1; i <= 4; i++) { if ((G.turn + i) % 4 === owner) { passedOwner = true; break; } if ((G.turn + i) % 4 === nxt) break; }
    if (passedOwner) {
      // 接风: 队友还有牌 → 队友自由领出; 否则退回下一个活人
      const mate = (owner + 2) % 4;
      const relay = G.hands[mate].length > 0 ? mate : nxt;
      G.lastPlay = null;
      clearPassed();                   // 新一轮 → 清"不要"标记
      G.turn = relay;
      refresh();
      if (relay === mate) toast('接风 · ' + SEAT_NAME[mate] + ' 领出', mate);
      else toast('新一轮', relay);
    } else {
      G.turn = nxt;
      refresh();
    }
  } else {
    G.turn = nxt;
    refresh();
  }

  G.sel.clear();
  G.hintList = [];
  updateBar();

  if (G.turn !== 0) {
    clearTurnTimer();
    scheduleAi();
  } else {
    startTurnTimer();                 // 轮到我 → 开始10秒倒计时
  }
}

/* ---------- AI 行动 ---------- */
function aiTurn() {
  if (!G.running || G.turn === 0) return;
  const seat = G.turn;
  const hand = G.hands[seat];
  const prev = G.lastPlay ? G.lastPlay.e : null;
  const mateSeat = (seat + 2) % 4;
  const opt = {
    mateLeading: !!(G.lastPlay && G.lastPlay.seat === mateSeat),
    danger: G.hands.some((h, i) => teamOf(i) !== teamOf(seat) && h.length > 0 && h.length <= 4),
  };
  const pick = aiChoose(hand, prev, G.curLevel, opt);
  if (pick) doPlay(seat, pick.cards, pick.e);
  else doPass(seat);
}

/* ---------- 我方操作 ---------- */
function myPlay() {
  if (G.turn !== 0) return;
  const cards = G.hands[0].filter(c => G.sel.has(c.id));
  if (!cards.length) return;

  // 含逢人配 → 让玩家决定当什么牌(有多种合法可能时)
  const hasWild = cards.some(c => isWild(c, G.curLevel));
  if (hasWild) {
    const prev = G.lastPlay ? G.lastPlay.e : null;
    const opts = wildOptions(cards, G.curLevel).filter(o => beats(o.e, prev));
    if (opts.length > 1) return showWildPick(cards, opts);
    if (opts.length === 1) return doPlay(0, cards, opts[0].e);
    // 一个都打不过 → 落到下面统一报错
  }

  const e = evalCards(cards, G.curLevel);
  if (!e) return toast('牌型不对', 0);
  if (!beats(e, G.lastPlay ? G.lastPlay.e : null)) return toast('打不过', 0);
  doPlay(0, cards, e);
}

/* ---------- 逢人配选择器 ---------- */
function showWildPick(cards, opts) {
  clearTurnTimer();                    // 选择期间暂停计时
  const list = $('wpList');
  list.innerHTML = '';
  opts.slice(0, 12).forEach(o => {
    const d = document.createElement('div');
    d.className = 'wp-item' + (o.e.type === 'bomb' ? ' bomb' : '');
    d.textContent = o.label;
    d.onclick = () => {
      $('wildPick').classList.remove('on');
      doPlay(0, cards, o.e);
    };
    list.appendChild(d);
  });
  $('wildPick').classList.add('on');
}

function myPass() {
  if (G.turn !== 0 || !G.lastPlay) return;
  doPass(0);
}

function myHint() {
  if (G.turn !== 0) return;
  if (!G.hintList.length) {
    const prev = G.lastPlay ? G.lastPlay.e : null;
    const combos = genCombos(G.hands[0], G.curLevel).filter(o => beats(o.e, prev));
    combos.sort((a, b) => {
      if (a.e.type === 'bomb' && b.e.type !== 'bomb') return 1;
      if (b.e.type === 'bomb' && a.e.type !== 'bomb') return -1;
      return a.e.val - b.e.val || a.cards.length - b.cards.length;
    });
    G.hintList = combos;
    G.hintIdx = 0;
    if (!combos.length) return toast('没有能出的牌', 0);
  }
  const pick = G.hintList[G.hintIdx % G.hintList.length];
  G.hintIdx++;
  G.sel = new Set(pick.cards.map(c => c.id));
  renderHand();
  updateBar();
}

/* 理牌: 先算"最少出牌次数"的拆分,再按拆分结果重排手牌
 * 连点可循环高亮每一手,方便照着出
 */
function mySort() {
  const h = G.hands[0];
  if (!h.length) return;
  const r = arrangeHand(h, G.curLevel);
  G.plan = r.hands;
  G.planIdx = 0;
  // 按拆分顺序重排: 同一手的牌相邻,组内按点数排
  const seen = new Set();
  const ordered = [];
  r.hands.forEach(g => {
    sortHand(g.cards, G.curLevel).forEach(c => {
      if (!seen.has(c.id)) { seen.add(c.id); ordered.push(c); }
    });
  });
  h.forEach(c => { if (!seen.has(c.id)) ordered.push(c); });
  G.hands[0] = ordered;
  // 选中第一手,方便直接出牌
  G.sel.clear();
  r.hands[0].cards.forEach(c => G.sel.add(c.id));
  renderHand();
  updateBar();
  const names = r.hands.map(g => typeName(g.e)).join(' · ');
  toast('理牌: 最少 ' + r.count + ' 手 → ' + names, 0);
}

/* ---------- 记牌器 ---------- */
// 两副牌: 每个点数 8 张(4花色×2副), 大小王各 2 张(每副1张)
function renderCounter() {
  const box = $('counter');
  const total = {};
  RANKS.forEach(r => total[r] = 8);
  total['JOKER_S'] = 2; total['JOKER_B'] = 2;

  // 已出的 + 我手上的 = 已知,剩余 = 别人手里可能有的
  const gone = {};
  (G.played || []).forEach(c => gone[c.r] = (gone[c.r] || 0) + 1);
  const mine = {};
  G.hands[0].forEach(c => mine[c.r] = (mine[c.r] || 0) + 1);

  const order = RANKS.concat(['JOKER_S', 'JOKER_B']);
  const label = r => r === 'JOKER_S' ? '小' : r === 'JOKER_B' ? '大' : r;

  let head = '', row = '';
  order.forEach(r => {
    const left = total[r] - (gone[r] || 0) - (mine[r] || 0);
    const isLv = (r === G.curLevel);
    head += '<td class="hd' + (isLv ? ' lv' : '') + '">' + label(r) + '</td>';
    row += '<td class="' + (left <= 0 ? 'z' : '') + '">' + left + '</td>';
  });

  box.innerHTML = '<div class="ttl">剩余未现牌（不含我手牌）· 级牌 ' + G.curLevel + '</div>' +
    '<table><tr>' + head + '</tr><tr>' + row + '</tr></table>';
}

function toggleCounter() {
  const box = $('counter');
  const on = box.classList.toggle('on');
  if (on) renderCounter();
}

/* ---------- 局终结算 ---------- */
function endRound() {
  G.running = false;
  G.lastOrder = G.finished.slice();      // 记录名次,供下局进贡
  const winner = G.finished[0];
  const wTeam = teamOf(winner);
  const mate = (winner + 2) % 4;
  const matePos = G.finished.indexOf(mate) + 1;   // 2/3/4
  const up = matePos === 2 ? 3 : matePos === 3 ? 2 : 1;
  const desc = matePos === 2 ? '双下' : matePos === 3 ? '一带二' : '平局收尾';

  const isUs = wTeam === 0;
  const cur = isUs ? G.usLevel : G.themLevel;
  let idx = LEVELS.indexOf(cur) + up;
  const over = idx > LEVELS.indexOf('A');
  if (over) idx = LEVELS.indexOf('A');
  const nl = LEVELS[idx];
  if (isUs) G.usLevel = nl; else G.themLevel = nl;

  const order = G.finished.map((s, i) => (i + 1) + '. ' + SEAT_NAME[s]).join('　');

  if (over) {
    showDlg(isUs ? '🎉 我方胜利' : '😖 对方胜利',
      '打过 A,牌局结束<br><br>' + order, '再来一局', () => {
        G.usLevel = '2'; G.themLevel = '2'; G.curLevel = '2'; G.round = 1;
        G.lastOrder = null;              // 新开局不进贡
        deal();
      });
    return;
  }

  G.curLevel = nl;             // 下局打赢方的新级
  G.round++;
  showDlg((isUs ? '我方' : '对方') + '赢了本局',
    desc + ' · 升 ' + up + ' 级<br>' + order +
    '<br><br>下局打 <b>' + G.curLevel + '</b>　我方 ' + G.usLevel + ' / 对方 ' + G.themLevel,
    '下一局', deal);
}

/* ---------- 弹窗 ---------- */
function showDlg(title, body, btn, fn) {
  $('dTitle').innerHTML = title;
  $('dBody').innerHTML = body;
  $('dBtn').textContent = btn;
  $('mask').classList.add('on');
  $('dBtn').onclick = () => { $('mask').classList.remove('on'); fn && fn(); };
}

/* ---------- 绑定 ---------- */
$('btnPlay').addEventListener('click', myPlay);
$('btnPass').addEventListener('click', myPass);
$('btnHint').addEventListener('click', myHint);
$('btnSort').addEventListener('click', mySort);
$('btnCount').addEventListener('click', toggleCounter);
// 语音开关: 点击切换静音
voiceInit();
$('hVoice').addEventListener('click', () => {
  VOICE.on = !VOICE.on;
  $('hVoice').textContent = VOICE.on ? '🔊' : '🔇';
  if (VOICE.on) voiceSay('已开启');
});
$('wpCancel').addEventListener('click', () => {
  $('wildPick').classList.remove('on');
  startTurnTimer();                        // 取消选择 → 恢复计时
});
$('wildPick').addEventListener('click', e => {
  if (e.target.id === 'wildPick') {
    $('wildPick').classList.remove('on');   // 点遮罩关闭
    startTurnTimer();                       // 恢复计时
  }
});
window.addEventListener('resize', () => { if (G.hands[0].length) renderHand(); });

showDlg('掼蛋', '四人两队 · 打级升A<br>你与「对家」是一队<br><br>红桃级牌 = 逢人配', '开始', deal);
refresh();
