
/* ===== 电脑 AI ===== */
// 把手牌拆成候选组合
function genCombos(hand, level){
  const out=[];
  const wilds = hand.filter(c=>isWild(c,level));
  const norm  = hand.filter(c=>!isWild(c,level));
  const byVal = {};
  norm.forEach(c=>{ const v=cmpVal(c,level); (byVal[v]=byVal[v]||[]).push(c); });
  const vals = Object.keys(byVal).map(Number).sort((a,b)=>a-b);

  // 单/对/三/炸
  for(const v of vals){
    const g = byVal[v];
    for(let k=1;k<=g.length;k++){
      const pick = g.slice(0,k);
      const e = evalCards(pick, level);
      if(e) out.push({cards:pick, e});
    }
    // 通配补对/三
    if(wilds.length){
      for(let w=1;w<=wilds.length;w++){
        for(let k=1;k<=g.length;k++){
          const pick = g.slice(0,k).concat(wilds.slice(0,w));
          if(pick.length>5) continue;
          const e = evalCards(pick, level);
          if(e) out.push({cards:pick, e});
        }
      }
    }
  }
  // 单独打通配(当单张)
  wilds.forEach(c=>{ const e=evalCards([c],level); if(e) out.push({cards:[c],e}); });

  // 顺子 / 连对 / 钢板 / 三带二: 暴力小组合搜索(限规模)
  const pool = norm.filter(c=>!isJoker(c));
  const uniqByVal = vals.filter(v=>v<=14).map(v=>byVal[v][0]);
  // 顺子
  for(let i=0;i+4<uniqByVal.length+ (wilds.length?1:0);i++){
    for(let s=0;s<=uniqByVal.length-1;s++){
      const seq = uniqByVal.slice(s,s+5);
      if(seq.length===5){ const e=evalCards(seq,level); if(e&&e.type==='straight') out.push({cards:seq,e}); }
      if(wilds.length&&uniqByVal.length>=4){
        const seq4 = uniqByVal.slice(s,s+4);
        if(seq4.length===4){ const p=seq4.concat([wilds[0]]); const e=evalCards(p,level);
          if(e&&e.type==='straight') out.push({cards:p,e}); }
      }
    }
    break;
  }
  // 连对 / 钢板
  for(let s=0;s<vals.length;s++){
    // 三连对
    let p=[], ok=true;
    for(let k=0;k<3;k++){
      const v=vals[s]+k; const g=byVal[v];
      if(!g||g.length<2){ok=false;break} p=p.concat(g.slice(0,2));
    }
    if(ok&&p.length===6){ const e=evalCards(p,level); if(e&&e.type==='plate') out.push({cards:p,e}); }
    // 钢板
    p=[];ok=true;
    for(let k=0;k<2;k++){
      const v=vals[s]+k; const g=byVal[v];
      if(!g||g.length<3){ok=false;break} p=p.concat(g.slice(0,3));
    }
    if(ok&&p.length===6){ const e=evalCards(p,level); if(e&&e.type==='tripsPair') out.push({cards:p,e}); }
  }
  // 三带二
  for(const v of vals){
    if(byVal[v].length>=3){
      const t=byVal[v].slice(0,3);
      for(const v2 of vals){
        if(v2===v) continue;
        if(byVal[v2].length>=2){
          const p=t.concat(byVal[v2].slice(0,2));
          const e=evalCards(p,level);
          if(e&&e.type==='fullhouse') out.push({cards:p,e});
        }
      }
    }
  }
  // 去重
  const seen=new Set(), uniq=[];
  for(const o of out){
    const k=o.cards.map(c=>c.id).sort().join(',');
    if(!seen.has(k)){seen.add(k);uniq.push(o)}
  }
  return uniq;
}

function aiChoose(hand, prev, level, opt){
  opt = opt||{};
  const combos = genCombos(hand, level);
  const legal = combos.filter(o=>beats(o.e, prev));
  if(!legal.length) return null;

  if(!prev){
    // 主动出牌: 优先出小的、非炸弹、长牌型
    const nonBomb = legal.filter(o=>o.e.type!=='bomb');
    const pick = (nonBomb.length?nonBomb:legal).slice().sort((a,b)=>{
      const rank = t=>({straight:0,plate:0,tripsPair:0,fullhouse:1,trips:2,pair:3,single:4,bomb:9})[t.type]??5;
      const d = rank(a.e)-rank(b.e); if(d) return d;
      return a.e.val-b.e.val;
    })[0];
    return pick;
  }
  // 跟牌: 队友领出则倾向不压
  if(opt.mateLeading && Math.random()<0.55) return null;

  const nonBomb = legal.filter(o=>o.e.type!=='bomb');
  if(nonBomb.length){
    // 选能压住的最小
    nonBomb.sort((a,b)=>a.e.val-b.e.val || a.cards.length-b.cards.length);
    // 手牌多时不轻易拆
    return nonBomb[0];
  }
  // 只有炸弹: 对手快走完 或 牌少时才炸
  if(opt.danger || hand.length<=8){
    legal.sort((a,b)=>a.e.bombLv-b.e.bombLv || a.e.val-b.e.val);
    return legal[0];
  }
  return null;
}
