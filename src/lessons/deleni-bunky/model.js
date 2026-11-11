// The cell-division model: where every chromatid, fibre and membrane is at any moment of mitosis and
// of both meiotic divisions, as one keyframed function (divState), and how to draw it (drawCells).
// Pure: no DOM, no GL. model.test.ts pins the facts a learner is examined on.
// @ts-nocheck
import { PI, lerp, kf, kf3, rz, rx, add, sub, mulS, norm, mix3 } from '../../kit/math.ts'

// ---------- chromosome sets (2n = 4: one long pair, one short pair) ----------
export const B=.06, SC=.76, DX=.9;            // homolog half-spacing; daughter scale; daughter centre
const base=[
  {id:0,len:.30,cf:.5, col:'m',home:[-.17,-.13,.1], rot:.5, psiH:.6, jit:.4},
  {id:1,len:.30,cf:.5, col:'p',home:[.15,.17,-.12], rot:-.7,psiH:-.5,jit:-.5},
  {id:2,len:.21,cf:.36,col:'m',home:[.16,-.16,.14], rot:1.1,psiH:.9, jit:.6},
  {id:3,len:.21,cf:.36,col:'p',home:[-.14,.16,-.1], rot:-.3,psiH:-.8,jit:-.35},
];
export const SETS={};
// mitosis: chromosomes sit on a ring in the equatorial plane, like Flemming's "star" seen from the pole
SETS.mit=base.map((c,i)=>{const f=PI/4+[0,2,1,3][i]*PI/2;return{...c,plate:[0,.3*Math.cos(f),.3*Math.sin(f)],psiP:f,e:mulS(c.home,.6),tip:{}};});
// meiosis I: bivalents; second pair flipped (independent assortment). Inner chromatids carry the crossover.
const m1=[{plate:[-B,-.2,.05],e:[-.02,-.1,.04]},{plate:[B,-.2,.05],e:[.02,-.1,.04]},{plate:[B,.2,-.05],e:[-.03,.11,-.04]},{plate:[-B,.2,-.05],e:[.03,.11,-.04]}];
SETS.mei1=base.map((c,i)=>({...c,...m1[i],paired:rz(m1[i].plate,.5),tip:{[-Math.sign(m1[i].plate[0])]:true}}));
// meiosis II: each daughter inherits its chromosomes exactly where telophase I left them
const mei2=theta=>SETS.mei1.filter(c=>Math.sign(c.plate[0])===Math.sign(theta)).map((c,k)=>{
  return {...c,home:mulS(rz(c.e,-theta),1/SC),rot:c.jit-theta,psiH:0,psiP:0,plate:[0,c.len>.25?-.17:.15,0],e:[.03*(k?1:-1),k?.09:-.08,k?.05:-.05],jit:k?.5:-.4};
});
SETS.mei2L=mei2(-PI/2); SETS.mei2R=mei2(PI/2);

// ---------- state of one dividing cell at generic phase u (0 interphase … 7 two cells) ----------
export function divState(kind,u,set,time){
  const S={kind,u,set};
  S.r=kf(u,[[0,.86],[1,1],[4,1],[5,.93],[6,.9],[7,SC]]);   // the cell grows through interphase
  S.d=kf(u,[[4,0],[5,.33],[6,.5],[7,DX]]);
  S.q=kf(u,[[4,0],[5,.56],[6,.6],[7,DX]]);
  S.c=kf(u,[[1,0],[2.3,1],[5.1,1],[6.2,0]]);
  S.envA=kf(u,[[2,1],[2.6,0]]); S.nlA=kf(u,[[1.1,1],[1.9,0]]);
  S.dEnvA=kf(u,[[5.3,0],[6.1,1]]); S.dNlA=kf(u,[[5.9,0],[6.6,1]]);
  S.astA=kf(u,[[.9,0],[1.5,1],[5.2,1],[6.2,0]]);
  S.polA=kf(u,[[2.1,0],[2.9,1],[5,1],[5.9,0]]);
  S.kA=kf(u,[[2.45,0],[3,1],[5,1],[5.6,0]]);
  S.ringA=kf(u,[[5.7,0],[6.05,1],[6.7,1],[6.97,0]]);
  // membrane = two spheres joined by a smooth neck; cS is the neck's softness (1 = no waist, 0 = sharp furrow)
  S.cS=kf(u,[[4,.9],[6.2,.6],[6.8,.15],[7,0]]);S.h=Math.sqrt(Math.max(0,memF(S,0)));
  S.plateA=kf(u,[[2.8,0],[3.1,1],[3.9,1],[4.15,0]]);
  if(u<1)S.cen=[kf(u,[[.4,0],[.85,.046]]),-.62];
  else if(u<2.2){const a=kf(u,[[1,.075],[2.2,PI/2]]),rho=.62;S.cen=[rho*Math.sin(a),-rho*Math.cos(a)];}
  else S.cen=[kf(u,[[2.2,.62],[4,.62],[5,.84],[6,1.05],[7,DX+.62*SC]]),0];

  const g=kf(u,[[5,0],[6.1,1]]), yc=kf(u,[[4,1],[5,.55]]);
  const jig=kf(u,[[2,0],[2.5,.02],[3.3,.006],[4,0]]);
  const bA=kind==='mei2'?1:kf(u,[[.35,0],[.9,1]]);
  const vAmt=kf(u,[[4,0],[4.4,1],[5.3,1],[6.2,0]]);
  S.bA=bA; S.xo=kind==='mei1'?kf(u,[[1.55,0],[1.95,1]]):1;
  S.cc=[]; S.ch=[];
  const dl=.35, be=.75, whole=kind==='mei1';
  for(const ch of set){
    const tgt=Math.round(ch.rot/PI)*PI, away=p=>[lerp(p[1]*yc,ch.e[1],g),lerp(p[2]*yc,ch.e[2],g)];
    let C,rot,psi=0;
    if(whole){
      if(u<4){C=kf3(u,[[1,ch.home],[1.7,ch.paired],[2.4,ch.paired],[3,ch.plate]]);rot=kf(u,[[1,ch.rot],[1.7,.5],[2.4,.5],[3,0]]);}
      else{const s=Math.sign(ch.plate[0]);C=[s*S.q+lerp(ch.plate[0],ch.e[0],g),...away(ch.plate)];rot=ch.jit*g;}
    }else{
      psi=kf(u,[[1.8,ch.psiH],[3,ch.psiP]]);
      if(u<4){C=kf3(u,[[2,ch.home],[3,ch.plate]]);rot=kf(u,[[1.8,ch.rot],[3,tgt]]);}
    }
    if(C)C[0]+=jig*Math.sin(time*3+ch.id*2);
    S.cc[ch.id]={C,rot};
    for(const sg of[-1,1]){
      const side=whole?Math.sign(ch.plate[0]):sg*Math.cos(tgt);
      let P=C,r=rot;
      if(!whole&&u>=4){P=[side*S.q+ch.e[0]*g,...away(ch.plate)];r=tgt+ch.jit*g;}
      const tx=whole?-side:-sg, v=whole?vAmt*.55:vAmt;
      const dir=s=>{const x=lerp(sg*Math.sin(dl),tx*Math.cos(be),v),y=lerp(s*Math.cos(dl),s*Math.sin(be),v),n=Math.hypot(x,y);return[x/n,y/n];};
      S.ch.push({p:add(P,rx(rz([sg*.022*bA,0,0],r),psi)),rot:r,psi,up:dir(-1),dn:dir(1),len:ch.len,cf:ch.cf,col:ch.col,
        tip:ch.tip[sg]?(ch.col==='m'?'p':'m'):null,alpha:sg>0?bA:1,side,seed:ch.id*7.3+sg*1.9,id:ch.id,sg});
    }
  }
  return S;
}
export const memF=(S,x)=>S.r*S.r-x*x-S.d*S.d+Math.sqrt(4*x*x*S.d*S.d+(S.cS*S.d)**2);
export const NP=9;
export function chromPts(cd,c,tt){
  const lf=lerp(1.35,1,c),amp=(1-c)*.045,pts=[];
  const mk=(dir,L,k,s)=>{const a=L*lf*k/NP,e=Math.min(1,a/.04),w=s*amp*(Math.sin(a*26+cd.seed+tt)+.6*Math.sin(a*47+cd.seed*2.3-tt*.7))*e;
    return add(cd.p,rx(rz([dir[0]*a-dir[1]*w,dir[1]*a+dir[0]*w,amp*1.3*Math.sin(a*31+cd.seed*1.3+tt*.5)*e],cd.rot),cd.psi));};
  for(let k=NP;k>=0;k--)pts.push(mk(cd.up,cd.len*cd.cf,k,1));
  for(let k=1;k<=NP;k++)pts.push(mk(cd.dn,cd.len*(1-cd.cf),k,-1));
  return pts;
}
export const chiasma=(S,k)=>{const a=S.cc[k*2].C,b=S.cc[k*2+1].C;return add(mulS(add(a,b),.5),rz([0,k?.09:.1,0],S.cc[k*2].rot));};
export const fibre=(S,k,t)=>{const[cx,cy]=S.cen,al=k*PI/5,b=(k%2?.36:.7)*cx,m=[0,cy+b*Math.cos(al),b*Math.sin(al)],a=[-cx,cy,0],e=[cx,cy,0];
  return add(add(mulS(a,(1-t)*(1-t)),mulS(m,2*t*(1-t))),mulS(e,t*t));};


/** [chromosomes in the cell, DNA molecules, ploidy] — per pole once the groups have separated. */
export function stats(kind,u){
  if(kind==='mit')return u<.35?[4,4,'2n']:u<.9?[4,'4 → 8','2n']:u<4?[4,8,'2n']:u<6.5?[8,8,'2n + 2n']:[4,4,'2n'];
  if(kind==='mei1')return u<.35?[4,4,'2n']:u<.9?[4,'4 → 8','2n']:u<4?[4,8,'2n']:u<6.5?[4,8,'n + n']:[2,4,'n'];
  return u<4?[2,4,'n']:u<6.5?[4,4,'n + n']:[2,2,'n'];
}

const CHROM_FAMILY = ['chrom', 'kin', 'chd', 'koh']

/** Draw the cell (or, in meiosis II, both cells) for phase `kind` at generic time u. Returns the kit's SceneOut. */
export function drawCells(kind, u, s, g) {
  const hots = []
  if (kind === 'mei2') {
    const a = divState('mei2', u, SETS.mei2L, s.time), b = divState('mei2', u, SETS.mei2R, s.time + 9)
    drawCell({ x: -DX, y: 0, rot: -PI / 2, s: SC }, a, s, g, hots)
    drawCell({ x: DX, y: 0, rot: PI / 2, s: SC }, b, s, g, null)
    return { extent: [DX + SC * a.r, SC * (a.d + a.r)], hots }
  }
  const a = divState(kind, u, SETS[kind], s.time), rr = u < 4 ? 1 : a.r // fixed frame before division, so growth is visible
  drawCell({ x: 0, y: 0, rot: 0, s: 1 }, a, s, g, hots)
  return { extent: [a.d + rr, rr], hots }
}

function drawCell(fr, S, s, g, hots) {
  const TH = s.col, on = s.on, time = s.time
  const X = (p) => { const q = rz(p, fr.rot); return [fr.x + q[0] * fr.s, fr.y + q[1] * fr.s, q[2] * fr.s] }
  const O = X([0, 0, 0]), Xd = (v) => norm(sub(X(v), O))
  const sc = fr.s, [cx, cy] = S.cen, u = S.u, h = S.h
  if (on('membrane')) {
    let lo = S.d + S.r, hi = S.d + S.r + .4; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; memF(S, m) > 0 ? lo = m : hi = m }
    const e = (S.cS * S.d) ** 2
    g.glassRevolve(X, Xd, (t) => {
      const x = -lo * Math.cos(PI * t), F = Math.max(0, memF(S, x)), ro = Math.sqrt(F)
      const dF = -2 * x + (S.d > 1e-6 ? 4 * x * S.d * S.d / Math.sqrt(4 * x * x * S.d * S.d + e + 1e-12) : 0), l = Math.hypot(dF / 2, ro) || 1
      return [x, ro, F > 0 ? -dF / 2 / l : Math.sign(x), F > 0 ? ro / l : 0]
    }, TH.mem, [...TH.memP, 1], false)
    if (S.ringA > .01 && h > 0) { const pts = []; for (let k = 0; k < 40; k++) { const a = k / 40 * 2 * PI; pts.push(X([0, h * Math.cos(a), h * Math.sin(a)])) } g.tube(pts, .02 * S.ringA * sc, TH.act, 6, true) }
  }
  if (on('nucleus')) {
    const nuc = (x, rad, envA, nlA) => { if (envA > .01) g.glassSphere(X([x, 0, 0]), rad * sc, TH.nuc, [...TH.nucP, envA], true); if (nlA > .01) g.sphere(X([x, 0, 0]), rad * .18 * nlA * sc, TH.nl) }
    nuc(0, .48, S.envA, S.nlA); for (const sd of [-1, 1]) nuc(sd * S.q, .48 * SC, S.dEnvA, S.dNlA)
  }
  if (on('spindle')) {
    if (S.polA > .01) for (let k = 0; k < 10; k++) { const pts = []; for (let i = 0; i <= 10; i++) pts.push(X(fibre(S, k, i / 10))); g.tube(pts, .0055 * S.polA * sc, TH.tub, 5) }
    if (S.astA > .01) for (const sd of [-1, 1]) for (let k = 0; k < 12; k++) {
      const a = k * 2.4, b = Math.acos(1 - 2 * (k + .5) / 12), dv = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)]
      g.tube([X([sd * cx, cy, 0]), X(add([sd * cx, cy, 0], mulS(dv, .12 * S.astA)))], .0045 * sc, TH.tub, 4)
    }
    if (S.kA > .01) for (const cd of S.ch) g.tube([X([cd.side * cx, cy, 0]), X(mix3([cd.side * cx, cy, 0], cd.p, S.kA))], .0075 * sc, TH.tub, 5)
    for (const sd of [-1, 1]) g.sphere(X([sd * cx, cy, 0]), .028 * sc, TH.cen)
    if (S.plateA > .01) { const pts = []; for (let k = 0; k < 48; k++) { const a = k / 48 * 2 * PI; pts.push(X([0, .62 * Math.cos(a), .62 * Math.sin(a)])) } g.tube(pts, .004 * S.plateA * sc, TH.plate, 4, true) }
  }
  const c = S.c, w = lerp(.0075, .028, c) * sc, tt = time * .8 * (1 - c), lod = s.lod && CHROM_FAMILY.includes(s.focus)
  if (on('chrom')) {
    for (const cd of S.ch) {
      if (cd.alpha < .02) continue
      const dim = lod && cd.id !== S.set[0].id ? .72 : 0, col = mix3(TH[cd.col], s.bg, dim), tip = cd.tip ? mix3(col, mix3(TH[cd.tip], s.bg, dim), S.xo) : col
      // S phase: the copy grows along its template, with a marker where replication has got to
      const all = chromPts(cd, c, tt).map(X), growing = cd.sg > 0 && cd.alpha < .98, pts = growing ? all.slice(0, Math.max(2, Math.round(cd.alpha * 2 * NP) + 1)) : all, r = w, last = pts.length - 1
      g.tube(pts, r, (i) => i >= NP + 5 ? tip : col, 8); g.sphere(pts[0], r, col); g.sphere(pts[last], r, growing ? col : tip)
      if (growing) g.sphere(pts[last], r * 2.2, TH.act)
      if (c > .3 && !growing) g.sphere(X(add(cd.p, rx(rz([cd.sg * lerp(.0075, .028, c) * .75, 0, 0], cd.rot), cd.psi))), r * .62 * c, mix3(TH.kin, s.bg, dim))
    }
    if (S.kind === 'mei1' && S.xo > .01 && S.xo < .99) { const a = Math.sin(S.xo * PI); for (const k of [0, 1]) g.sphere(X(chiasma(S, k)), (.02 + .03 * a) * sc, TH.act) }
    // cohesin beads: only when the learner has zoomed into the chromosome
    const a0 = S.ch[0], b0 = S.ch[1], together = S.bA > .6 && (S.kind === 'mei1' || u < 4)
    if (lod && together && c > .5) { const mid = mulS(add(a0.p, b0.p), .5); for (const dy of [-.03, 0, .03]) g.sphere(X(add(mid, rx(rz([0, dy, 0], a0.rot), a0.psi))), .009 * sc, TH.act) }
    if (hots) {
      if (lod) { const lo = (v) => rx(rz(v, a0.rot), a0.psi); hots.push(['kin', X(add(a0.p, lo([-.05, 0, 0])))], ['chd', X(chromPts(b0, c, tt)[3])]); if (together && c > .5) hots.push(['koh', X(add(mulS(add(a0.p, b0.p), .5), lo([0, .05, 0])))]) }
      else hots.push(['chrom', X(a0.p)])
      if (S.kind === 'mei1' && u > 1.75 && u < 4) hots.push(['biv', X(mulS(add(S.cc[2].C, S.cc[3].C), .5))])
      if (S.kind === 'mei1' && u > 1.55 && u < 4) hots.push(['chi', X(chiasma(S, 0))])
    }
  }
  if (hots) {
    if (on('membrane')) { hots.push(['mem', X([-S.d, .8 * S.r, .6 * S.r])]); if (S.ringA > .5 && h > 0) hots.push(['prst', X([0, h * .707, h * .707])]) }
    if (on('nucleus')) {
      const dn = norm([-.3, .3, .9])
      if (S.envA > .5) hots.push(['obal', X(mulS(dn, .48))]); else if (S.dEnvA > .5) hots.push(['obal', X(add([-S.q, 0, 0], mulS(dn, .48 * SC)))])
      if (S.nlA > .5) hots.push(['jad', X([0, 0, 0])]); else if (S.dNlA > .5) hots.push(['jad', X([-S.q, 0, 0])])
    }
    if (on('spindle')) { hots.push(['cen', X([cx, cy, 0])]); if (S.polA > .6 && u < 5.2) hots.push(['vret', X(fibre(S, 1, .3))]); if (S.plateA > .5) hots.push(['rov', X([0, .44, .44])]) }
  }
}
