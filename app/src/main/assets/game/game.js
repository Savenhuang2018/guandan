
/* ===== 掼蛋主控 =====
 * 座位: 0=我(下) 1=右家(下家) 2=对家(上) 3=左家(上家)
 * 队伍: 0&2 = 我方,  1&3 = 对方
 * 出牌顺序: 0 -> 1 -> 2 -> 3 -> 0
 */
const SEAT_KEY = ['S','E','N','W'];
const SEAT_NAME = ['我','右家','对家','左家'];
const LEVELS = RANKS;                       // '2'..'A'
const RANK_NAME = ['头游','二游','三游','末游'];

const G = {
  hands: [[], [], [], []],
  turn: 0,
  lastPlay: null,        // {seat, cards, e}
  finished: [],          // 出完牌的座位顺序
  rankOf: [0, 0, 0, 0],  // 各座名次(1~4, 0=未出完); 持续显示到下一局发牌
  curLevel: '2',         // 本局级牌
  usLevel: '2',
  themLevel: '2',
  round: 1,
  running: false,
  sel: new Set(),        // 选中的牌 id
  hintList: [],
  hintIdx: 0,
  aiTimer: null,
  voiceGate: null,          // 门闩: AI 出牌前要等的那句语音
  gateSeq: 0,               // 门闩序号, 防过期回调乱入
  turnOwner: -1,            // 当前计时归属的座位(-1=无)
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
    renderRankTag(s, k);
  }
  // 我自己的"不要"标记
  const myTag = $('pS');
  if (myTag) myTag.classList.toggle('on', !!G.passed[0] && G.hands[0].length > 0);
  renderRankTag(0, 'S');
  $('hLevel').textContent = G.curLevel;
  $('hUs').textContent = G.usLevel;
  $('hThem').textContent = G.themLevel;
  $('hRound').textContent = G.round;
}

/* 名次标记: 头游/二游/三游/末游,持续显示到下一局发牌 */
function renderRankTag(seat, k) {
  const el = $('r' + k);
  if (!el) return;
  const rank = G.rankOf[seat];
  if (!rank) { el.classList.remove('on', 'first', 'last'); el.textContent = ''; return; }
  el.textContent = RANK_NAME[rank - 1];
  el.classList.add('on');
  el.classList.toggle('first', rank === 1);
  el.classList.toggle('last', rank === 4);
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

/* 座位 → 计时器 DOM(座位0 是我, 用手牌上沿那个; 其余用头像旁小圆牌) */
const TIMER_EL = ['hTimerChip', 'tE', 'tN', 'tW'];

function timerNodes(seat) {
  const chip = $(TIMER_EL[seat]);
  if (!chip) return { chip: null, num: null };
  // 座位0 的数字在 #hTimer, 其余在各自的 <b>
  const num = seat === 0 ? $('hTimer') : chip.querySelector('b');
  return { chip, num };
}

function clearTurnTimer() {
  clearInterval(G.turnTimer);
  G.turnTimer = null;
  G.turnLeft = 0;
  G.turnOwner = -1;
  // 全部座位的计时器一起熄灭(防止切换回合时残留上一家的)
  for (let s = 0; s < 4; s++) {
    const { chip, num } = timerNodes(s);
    if (num) num.textContent = '--';
    if (chip) chip.classList.remove('urgent', 'on');
  }
}

/* 起表: 每位玩家独立计时, seat 省略时为当前回合者 */
function startTurnTimer(seat) {
  clearTurnTimer();
  if (!G.running) return;
  const s = (seat === undefined) ? G.turn : seat;
  if (s < 0 || s > 3) return;
  if (G.hands[s].length === 0) return;              // 已出完的不计时
  // 弹窗打开时(逢人配/结算)不计时,避免玩家被强制打断
  if ($('wildPick').classList.contains('on') || $('mask').classList.contains('on')) return;
  // 领出(桌面无牌可跟)需要规划整手 → 20秒; 跟牌 → 10秒
  G.turnLeft = G.lastPlay ? TURN_LIMIT : LEAD_LIMIT;
  G.turnOwner = s;
  const { chip, num } = timerNodes(s);
  if (num) num.textContent = G.turnLeft;
  if (chip) chip.classList.add('on');
  G.turnTimer = setInterval(() => {
    G.turnLeft--;
    if (num) num.textContent = G.turnLeft;
    if (chip) chip.classList.toggle('urgent', G.turnLeft <= 3);
    if (G.turnLeft <= 0) {
      const owner = G.turnOwner;
      clearTurnTimer();
      // 只对人类强制代打; AI 超时说明它还在思考,交回 scheduleAi 即可
      if (owner === 0) autoPlayTimeout();
      else if (G.running && G.turn === owner) scheduleAi();
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
  // 操作键整条按需显隐: 非我回合完全不占位(display:none)
  const ab = $('actbar');
  if (ab) ab.classList.toggle('on', !!my);
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
  G.rankOf = [0, 0, 0, 0];     // 新局清名次标记(上局的显示到此刻为止)
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
      startTurnTimer(G.turn);         // 谁先出谁起表(AI 也显示)
      if (G.turn !== 0) scheduleAi();
    });
}

function cardText(c) {
  if (isJoker(c)) return c.r === 'JOKER_B' ? '大王' : '小王';
  return SUIT_CH[c.s] + c.r;
}

/* AI 出牌调度: 必须等上家把话说完再出, 否则语音被 QUEUE_FLUSH 打断,
 * 长牌型(如"三带二""同花顺")永远听不全。
 * G.voiceGate 是一个 Promise 风格的门闩: 上一句说完才放行。
 */
function scheduleAi() {
  clearTimeout(G.aiTimer);
  const seq = ++G.gateSeq;             // 防串: 期间若局面变了就作废
  const go = () => {
    if (seq !== G.gateSeq) return;      // 已被更新的调度取代
    if (!G.running || G.turn === 0) return;
    G.aiTimer = setTimeout(aiTurn, 260 + Math.random() * 240);
  };
  if (G.voiceGate) {
    const g = G.voiceGate;
    G.voiceGate = null;
    g(go);                              // 说完后再排延时
  } else {
    go();
  }
}

/* 登记一个"等这句说完"的门闩, 由 doPlay/doPass 调用 */
function setVoiceGate(fn) { G.voiceGate = fn; }

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
  // 语音报牌型, 并登记门闩: 下一家(AI)要等这句说完才出牌
  setVoiceGate(cb => voicePlayThen(e, cards, G.curLevel, cb));

  if (G.hands[seat].length === 0) {
    G.finished.push(seat);
    const rank = G.finished.length;
    const tag = RANK_NAME[rank - 1];
    G.rankOf[seat] = rank;                        // 持久名次,渲染到座位旁
    setTimeout(() => toast(SEAT_NAME[seat] + ' ' + tag, seat), 420);
  }
  refresh();
  advance();
}

function doPass(seat) {
  if (seat === 0) clearTurnTimer();               // 我过牌了,立刻停表
  G.passed[seat] = true;                          // 持久标记"不要",直到新一轮
  toast('不要', seat);
  setVoiceGate(cb => voicePassThen(cb));          // 语音报"不要" + 门闩
  refresh();
  advance();
}

/* ---------- 推进回合 ---------- */
function clearPassed() { G.passed = [false, false, false, false]; }

function advance() {
  // 局终判定 —— 必须原子,立刻停止接受新动作
  //   1) 出现三游(只剩1家没出完) → 结束,剩下那家为末游
  //   2) 同一队包揽头游+二游(双下) → 立刻结束,不必打到三游
  const dd = G.finished.length >= 2 && teamOf(G.finished[0]) === teamOf(G.finished[1]);
  if (activeCount() <= 1 || dd) {
    if (G.ending) return;          // 防重入(快速连点/异步竞态)
    G.ending = true;
    G.running = false;             // 立刻封盘,不等 endRound 的定时器
    clearTurnTimer();              // 局终停表
    // 未出完的按当前手牌数补名次(少的排前面),保证 finished 恒为4家
    // —— doTribute 要按 order[2]/order[3] 取三游末游,缺项会读到 undefined
    G.hands
      .map((h, s) => ({ s, n: h.length }))
      .filter(x => x.n > 0 && G.finished.indexOf(x.s) < 0)
      .sort((a, b) => a.n - b.n)
      .forEach(x => {
        G.finished.push(x.s);
        G.rankOf[x.s] = G.finished.length;   // 这些家不经 doPlay,名次在此补上
      });
    clearTimeout(G.aiTimer);
    updateBar();
    refresh();                       // 让名次标记立刻显示,不等下一次渲染
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
    startTurnTimer(G.turn);           // AI 也各自计时(显示在其头像旁)
    scheduleAi();
  } else {
    startTurnTimer(0);                // 轮到我 → 开始倒计时
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

/* 提示: 按「最少出牌次数」推荐, 而非单纯按牌力大小。
 *
 * 原先只按 e.val 排序 → 手上有顺子时, 顺子里的小单张 val 最低会被优先推荐,
 * 等于拆掉一手好牌去跟一张单牌。正确判据是"拆牌代价":
 *   代价 = 出这组后剩余手牌的最少手数 - (整手最少手数 - 1)
 *   代价 0 = 这组正好是拆分方案里的一手, 不破坏结构(最优)
 *   代价 >0 = 出它会让后续多花手数(拆牌了)
 * 同代价再按牌力小的优先(留大牌), 炸弹永远最后。
 */
function hintCost(cards, baseCount, level) {
  const ids = new Set(cards.map(c => c.id));
  const rest = G.hands[0].filter(c => !ids.has(c.id));
  if (!rest.length) return 0;                    // 一把走完, 最优
  // budget 调小: 提示要即时响应, 不需要精确最优解
  const r = arrangeHand(rest, level, { budget: 4000, branch: 8 });
  return r.count - (baseCount - 1);
}

function myHint() {
  if (G.turn !== 0) return;
  if (!G.hintList.length) {
    const prev = G.lastPlay ? G.lastPlay.e : null;
    const combos = genCombos(G.hands[0], G.curLevel).filter(o => beats(o.e, prev));
    if (!combos.length) { G.hintList = []; return toast('没有能出的牌', 0); }

    // 整手的最少手数作为基准
    const base = arrangeHand(G.hands[0], G.curLevel, { budget: 8000, branch: 10 });
    const baseCount = base.count;

    // 候选过多时先粗筛(避免每个都跑一次搜索): 按牌力取前 40 个
    let pool = combos;
    if (pool.length > 40) {
      pool = pool.slice().sort((a, b) => a.e.val - b.e.val).slice(0, 40);
    }
    pool.forEach(o => { o._cost = hintCost(o.cards, baseCount, G.curLevel); });

    pool.sort((a, b) => {
      // 炸弹永远垫底(除非只剩它能出)
      const ab = a.e.type === 'bomb' ? 1 : 0, bb = b.e.type === 'bomb' ? 1 : 0;
      if (ab !== bb) return ab - bb;
      if (a._cost !== b._cost) return a._cost - b._cost;   // 不拆牌的优先
      return a.e.val - b.e.val || a.cards.length - b.cards.length;
    });

    G.hintList = pool;
    G.hintIdx = 0;
  }
  const pick = G.hintList[G.hintIdx % G.hintList.length];
  G.hintIdx++;
  G.sel = new Set(pick.cards.map(c => c.id));
  renderHand();
  updateBar();
  // 首次提示时说明推荐理由(代价0 = 不拆牌)
  if (G.hintIdx === 1 && pick._cost === 0) toast('提示: ' + typeName(pick.e) + '(不拆牌)', 0);
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
/* ---------- 菜单 ---------- */
/* 规则文本必须与 rules.js/game.js 的实际实现一致:
 *   炸弹大小顺序见 cmpBomb (同花顺 bombLv=5.5, 夹在 5炸 和 6炸 之间)
 *   升级步数见 endRound (双下+3 / 一带二+2 / 平局收尾+1)
 */
const RULES_HTML = `
<h4>基本</h4>
四人两队，你与<b>对家</b>一队。每人 27 张（两副牌），从 <b>2</b> 打到 <b>A</b>，先升到 A 并打过者胜。

<h4>牌型</h4>
<ul>
<li>单张 / 对子 / 三张</li>
<li><b>三带二</b>：三张 + 一对</li>
<li><b>顺子</b>：5 张连续（A 可作最大或最小）</li>
<li><b>三连对</b>：如 334455</li>
<li><b>钢板</b>：如 555666（两个连续三张）</li>
</ul>

<h4>炸弹（从小到大）</h4>
4炸 → 5炸 → <b>同花顺</b> → 6炸 → 7炸 → 8炸 → <b>四王炸</b><br>
<span style="opacity:.8">同花顺比 5 炸大、比 6 炸小；四王炸最大。</span>

<h4>逢人配</h4>
<b>红桃级牌</b>（打几时的红桃几）是万能牌，可当任意牌凑牌型，<b>但不能当大小王</b>。

<h4>出牌</h4>
上家出牌后必须<b>同牌型且更大</b>才能跟，炸弹可压任何非炸弹牌型。<br>
领出 <b>20 秒</b>、跟牌 <b>10 秒</b>，超时自动代打。

<h4>接风</h4>
某家出完牌后，若其余各家都"不要"，牌权归其<b>队友</b>自由领出。

<h4>升级</h4>
<ul>
<li>头游 + 二游同队（<b>双下</b>）：升 <b>3</b> 级</li>
<li>头游 + 三游同队（<b>一带二</b>）：升 <b>2</b> 级</li>
<li>头游 + 末游同队：升 <b>1</b> 级</li>
</ul>

<h4>进贡 / 还贡</h4>
上局末游需把<b>最大的牌</b>（红桃级牌除外）进贡给头游，头游还一张 10 以下的牌。<br>
手握<b>双大王</b>可<b>抗贡</b>，免进贡。
`;

function openMenu() {
  clearTurnTimer();                       // 菜单打开时暂停计时,避免被强制代打
  $('menuMask').classList.add('on');
}

function closeMenu(resume) {
  $('menuMask').classList.remove('on');
  // 关闭后恢复当前回合者的计时
  if (resume && G.running) startTurnTimer(G.turn);
}

function showRules() {
  $('rulesBody').innerHTML = RULES_HTML;
  $('rulesMask').classList.add('on');
}

/* 重新开始: 回到第一局, 级牌全部重置
 * 参照 endRound 里"再来一局"分支(853行): 只需重置状态 + deal(),
 * HUD 由 renderSeats() 内部刷新, 没有独立的 renderHud/startRound。
 */
function restartGame() {
  closeMenu(false);
  $('rulesMask').classList.remove('on');
  clearTurnTimer();
  clearTimeout(G.aiTimer);
  G.gateSeq++;                            // 作废进行中的语音门闩
  G.voiceGate = null;
  G.running = false;
  G.usLevel = '2';
  G.themLevel = '2';
  G.curLevel = '2';
  G.round = 1;
  G.lastOrder = null;                     // 新开局不进贡
  G.plan = null;
  G.hintList = [];
  G.sel.clear();
  showDlg('重新开始', '级牌回到 <b>2</b><br>四人两队 · 打级升A', '开始', () => {
    deal();
  });
}

/* 退出游戏: 优先调原生 finish(), 浏览器下退回首屏 */
function quitGame() {
  closeMenu(false);
  clearTurnTimer();
  clearTimeout(G.aiTimer);
  if (window.AndroidApp && window.AndroidApp.quit) {
    try { window.AndroidApp.quit(); return; } catch (e) {}
  }
  // 无原生桥(浏览器调试): 停止游戏并显示重开入口
  G.running = false;
  showDlg('已退出', '感谢试玩 👋', '重新开始', restartGame);
}

/* 安卓物理返回键: 按层级依次关闭, 什么都没开时打开菜单
 * (由 MainActivity.onBackPressed 调用)
 */
window.onAndroidBack = function () {
  if ($('rulesMask').classList.contains('on')) {
    $('rulesMask').classList.remove('on');
    return;
  }
  if ($('menuMask').classList.contains('on')) { closeMenu(true); return; }
  if ($('wildPick').classList.contains('on')) return;   // 逢人配必须选,不给退
  if ($('mask').classList.contains('on')) return;       // 结算/开局弹窗按按钮走
  openMenu();
};

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
// 菜单
$('hMenu').addEventListener('click', openMenu);
$('mClose').addEventListener('click', () => closeMenu(true));
$('mRules').addEventListener('click', showRules);
$('rulesClose').addEventListener('click', () => $('rulesMask').classList.remove('on'));
$('mRestart').addEventListener('click', restartGame);
$('mQuit').addEventListener('click', quitGame);
// 点遮罩空白处关闭
$('menuMask').addEventListener('click', e => { if (e.target === $('menuMask')) closeMenu(true); });
$('rulesMask').addEventListener('click', e => {
  if (e.target === $('rulesMask')) $('rulesMask').classList.remove('on');
});
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
