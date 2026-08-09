
/* ===== 掼蛋规则引擎 =====
 * 牌型: single pair trips fullhouse straight tripsPair(钢板) plate(三连对) bomb strJoker
 * 级牌(当前打的级) 红桃级牌=逢人配(wildcard)
 */
const SUITS = ['S','H','C','D'];               // 黑桃 红桃 梅花 方块
const SUIT_CH = {S:'♠',H:'♥',C:'♣',D:'♦'};
const SUIT_RED = {H:1,D:1};
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// 基础点数(不含级牌提升): 2=2 ... A=14, 小王15 大王16
function baseVal(r){
  if(r==='JOKER_S') return 15;
  if(r==='JOKER_B') return 16;
  const i = RANKS.indexOf(r);
  return i<0 ? 0 : i+2;
}
// 比较用点数: 级牌被提升到 15(仅次于王)
function cmpVal(card, level){
  if(card.r==='JOKER_S') return 16;
  if(card.r==='JOKER_B') return 17;
  if(card.r===level) return 15;
  return baseVal(card.r);
}

let _uid = 0;
function makeDeck(){
  const d=[];
  for(let k=0;k<2;k++){
    for(const s of SUITS) for(const r of RANKS) d.push({id:++_uid,r,s});
    d.push({id:++_uid,r:'JOKER_S',s:'J'});
    d.push({id:++_uid,r:'JOKER_B',s:'J'});
  }
  return d;                                     // 108张
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function isWild(c, level){ return c.s==='H' && c.r===level; }   // 红桃级牌
function isJoker(c){ return c.r==='JOKER_S'||c.r==='JOKER_B'; }

function sortHand(h, level){
  return h.slice().sort((a,b)=>{
    const d = cmpVal(b,level)-cmpVal(a,level);
    if(d) return d;
    return SUITS.indexOf(a.s)-SUITS.indexOf(b.s);
  });
}

/* ---------- 牌型识别 ---------- */
// 返回 {type, val, len, bombLv} 或 null
function evalCards(cards, level){
  const n = cards.length;
  if(!n) return null;
  const wilds = cards.filter(c=>isWild(c,level));
  const norm  = cards.filter(c=>!isWild(c,level));
  const w = wilds.length;

  // 四王(天王炸)
  if(n===4 && cards.every(isJoker)) return {type:'bomb',val:100,len:4,bombLv:100};

  // 王不能当普通牌用于顺子/连对; 逢人配不能替王
  const cnt = {};
  norm.forEach(c=>{ const v=cmpVal(c,level); cnt[v]=(cnt[v]||0)+1; });
  const vals = Object.keys(cnt).map(Number).sort((a,b)=>b-a);
  const groups = vals.map(v=>({v,c:cnt[v]}));

  // ---- 同点数集合: 单/对/三/炸 ----
  if(vals.length<=1){
    const v = vals.length? vals[0] : (w? 15 : 0);
    if(n===1) return {type:'single',val:v,len:1};
    if(n===2) return {type:'pair',val:v,len:2};
    if(n===3) return {type:'trips',val:v,len:3};
    if(n>=4)  return {type:'bomb',val:v,len:n,bombLv:n};   // 4~8张炸弹
  }

  // ---- 5张: 同花顺(炸弹级) 必须先判,否则被普通顺子截胡 ----
  if(n===5){
    const fl = tryStraightFlush(cards,norm,w,level);
    if(fl) return fl;
  }
  // ---- 三带二 ----
  if(n===5){
    const need3 = groups.find(g=>g.c+0>=3);
    // 用通配补足
    const fh = tryFullHouse(groups,w);
    if(fh) return fh;
    const st = tryStraight(cards,norm,w,level,5);
    if(st) return st;
    if(need3) {}
  }
  // ---- 顺子(5张) ----
  if(n===5){
    const st = tryStraight(cards,norm,w,level,5);
    if(st) return st;
  }
  // ---- 三连对(6张) / 钢板(6张 两个三张连续) ----
  if(n===6){
    const pl = tryPlate(groups,w);   if(pl) return pl;
    const tp = tryTripsPair(groups,w); if(tp) return tp;
  }
  // ---- 同花顺(5张,炸弹级=同花顺) ----
  if(n===5){
    const fl = tryStraightFlush(cards,norm,w,level);
    if(fl) return fl;
  }
  return null;
}

function tryFullHouse(groups,w){
  // 需 3+2
  if(groups.length===2){
    const [a,b]=groups;
    if(a.c===3&&b.c===2) return {type:'fullhouse',val:a.v,len:5};
    if(a.c===2&&b.c===3) return {type:'fullhouse',val:b.v,len:5};
    if(w===1){
      if(a.c===3&&b.c===1) return {type:'fullhouse',val:a.v,len:5};
      if(a.c===1&&b.c===3) return {type:'fullhouse',val:b.v,len:5};
      if(a.c===2&&b.c===2) return {type:'fullhouse',val:Math.max(a.v,b.v),len:5};
    }
    if(w===2){
      if(a.c===2&&b.c===1) return {type:'fullhouse',val:a.v,len:5};
      if(a.c===1&&b.c===2) return {type:'fullhouse',val:b.v,len:5};
      if(a.c===3) return {type:'fullhouse',val:a.v,len:5};
    }
  }
  if(groups.length===1&&w>=2) return {type:'fullhouse',val:groups[0].v,len:5};
  return null;
}

// 顺子: 5张连续单张, A可作最大(10JQKA)或最小(A2345)
function straightTop(vs,w,len){
  // vs: 去重后的点数(不含王/通配)
  const set = new Set(vs);
  const cands = [];
  // 以顶张 top 枚举, top范围 6..14(A)   A2345 用 top=5 表示(A当1)
  for(let top=len;top<=14;top++){
    let miss=0, ok=true;
    for(let k=0;k<len;k++){
      let v = top-k;
      if(v===1) v=14;                  // A当1
      if(v>14||v<1){ok=false;break}
      if(!set.has(v)) miss++;
    }
    if(ok&&miss<=w) cands.push({top,miss});
  }
  if(!cands.length) return null;
  cands.sort((a,b)=>b.top-a.top);
  return cands[0].top;
}
function tryStraight(cards,norm,w,level,len){
  if(norm.some(isJoker)) return null;
  const vs = norm.map(c=>baseVal(c.r));           // 顺子按自然点数,级牌不提升
  if(new Set(vs).size!==vs.length) return null;    // 不能有重复
  const top = straightTop(vs,w,len);
  if(top===null) return null;
  return {type:'straight',val:top,len};
}
function tryStraightFlush(cards,norm,w,level){
  if(norm.some(isJoker)) return null;
  const suits = new Set(norm.map(c=>c.s));
  if(suits.size>1) return null;
  const st = tryStraight(cards,norm,w,level,5);
  if(!st) return null;
  return {type:'bomb',val:st.val,len:5,bombLv:5.5,flush:true};  // 同花顺 > 5炸, < 6炸
}
// 三连对 AA BB CC
function tryPlate(groups,w){
  const pairsNeeded=3;
  const vs = groups.map(g=>g.v).sort((a,b)=>a-b);
  for(let top=4;top<=14;top++){
    let miss=0,ok=true;
    for(let k=0;k<pairsNeeded;k++){
      const v=top-k; if(v<2){ok=false;break}
      const g=groups.find(x=>x.v===v);
      const have=g?g.c:0;
      if(have>2){ok=false;break}
      miss += 2-have;
    }
    // 校验没有多余点数
    if(ok){
      const inRange = groups.every(g=>g.v<=top&&g.v>top-pairsNeeded);
      if(inRange&&miss<=w) return {type:'plate',val:top,len:6};
    }
  }
  return null;
}
// 钢板 AAA BBB
function tryTripsPair(groups,w){
  for(let top=3;top<=14;top++){
    let miss=0,ok=true;
    for(let k=0;k<2;k++){
      const v=top-k; if(v<2){ok=false;break}
      const g=groups.find(x=>x.v===v);
      const have=g?g.c:0;
      if(have>3){ok=false;break}
      miss += 3-have;
    }
    if(ok){
      const inRange = groups.every(g=>g.v<=top&&g.v>top-2);
      if(inRange&&miss<=w) return {type:'tripsPair',val:top,len:6};
    }
  }
  return null;
}

/* ---------- 大小比较 ---------- */
const BOMB_ORDER = t=>t==='bomb';
function beats(mine, prev){
  if(!prev) return true;
  const a=mine,b=prev;
  if(BOMB_ORDER(a.type)&&!BOMB_ORDER(b.type)) return true;
  if(!BOMB_ORDER(a.type)&&BOMB_ORDER(b.type)) return false;
  if(BOMB_ORDER(a.type)&&BOMB_ORDER(b.type)){
    const la=a.bombLv, lb=b.bombLv;
    if(la!==lb) return la>lb;
    return a.val>b.val;
  }
  if(a.type!==b.type) return false;
  if(a.len!==b.len) return false;
  return a.val>b.val;
}

const TYPE_CH = {single:'单张',pair:'对子',trips:'三张',fullhouse:'三带二',
  straight:'顺子',plate:'三连对',tripsPair:'钢板',bomb:'炸弹'};
function typeName(e){
  if(!e) return '';
  if(e.type==='bomb') return e.flush?'同花顺':(e.len>=6?e.len+'炸':(e.bombLv===100?'四王炸':e.len+'炸'));
  return TYPE_CH[e.type]||e.type;
}

/* ---------- 进贡 / 还贡 ---------- */
// 可进贡的牌: 最大的牌,但红桃级牌(逢人配)不上贡
function tributeCard(hand, level){
  const pool = hand.filter(c => !isWild(c, level));
  const src = pool.length ? pool : hand;      // 全是逢人配才被迫上贡
  return src.slice().sort((a,b) => cmpVal(b,level) - cmpVal(a,level))[0];
}
// 抗贡: 手里两个大王(双大王)可免进贡
function canRefuse(hand){
  return hand.filter(c => c.r === 'JOKER_B').length >= 2;
}
// 还贡必须 ≤10 (不含级牌/王); 没有则给最小的
function backCard(hand, level){
  const low = hand.filter(c => !isJoker(c) && !isWild(c,level) && baseVal(c.r) <= 10);
  const src = low.length ? low : hand.filter(c => !isWild(c,level));
  const use = src.length ? src : hand;
  return use.slice().sort((a,b) => cmpVal(a,level) - cmpVal(b,level))[0];
}
// 转移一张牌
function moveCard(fromHand, toHand, card){
  const i = fromHand.findIndex(c => c.id === card.id);
  if(i >= 0) fromHand.splice(i,1);
  toHand.push(card);
}

/* ---------- 逢人配手动指定 ---------- */
// 枚举: 把选中的逢人配替换成某张具体牌后,能组成哪些牌型
// 返回 [{asRank, asSuit, label, e}] —— 供玩家挑选
function wildOptions(cards, level){
  const wilds = cards.filter(c => isWild(c, level));
  if(!wilds.length) return [];
  const others = cards.filter(c => !isWild(c, level));
  const seen = new Set(), opts = [];

  // 候选替身: 所有点数 (逢人配不能替王)
  // 花色只在能凑成同花顺时才有区分意义,否则用黑桃占位避免重复选项
  RANKS.forEach(r => {
    SUITS.forEach(s => {
      // 替身不能又是逢人配本身(红桃级牌),否则等于没指定
      if(s === 'H' && r === level) return;
      const fake = others.concat(wilds.map((w,i) => ({id:'w'+i, r:r, s:s, _wild:true})));
      const e = evalCards(fake, level);
      if(!e) return;
      // 同花顺要区分花色,其余牌型花色无关 → 只保留一个代表
      const key = e.flush ? (e.type+':'+e.val+':'+e.len+':'+s)
                          : (e.type+':'+e.val+':'+e.len);
      if(seen.has(key)) return;
      seen.add(key);
      opts.push({ asRank:r, asSuit:s, e:e,
                  label: '当 ' + (e.flush ? SUIT_CH[s] : '') + r + ' · ' + typeName(e) });
    });
  });
  // 强的排前面: 炸弹 > 长牌型 > 大点数
  opts.sort((a,b) => {
    const rank = t => t.type==='bomb' ? 0 : 1;
    return rank(a.e)-rank(b.e) || b.e.len-a.e.len || b.e.val-a.e.val;
  });
  return opts;
}
