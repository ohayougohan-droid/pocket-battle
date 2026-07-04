// ヘッドレステスト: index.html の <script> を DOM スタブ上で実行し、
// 戦闘エンジンの新メカニクスの単体テスト + ランダム自動対戦のクラッシュ検証を行う。
// 実行: node test-headless.mjs
import { readFileSync } from "fs";
import vm from "vm";

/* ---------- DOM / ブラウザAPI スタブ ---------- */
function makeEl() {
  const el = {
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, insertAdjacentHTML() {},
    querySelector: () => makeEl(), querySelectorAll: () => [],
    setAttribute() {}, focus() {}, click() {},
    textContent: "", innerHTML: "", src: "", value: "", disabled: false, scrollTop: 0,
  };
  return el;
}
const elCache = {};
const audioParam = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
const audioNode = () => ({ connect: (x) => x, disconnect() {}, start() {}, stop() {}, gain: audioParam(), frequency: audioParam(), detune: audioParam(), delayTime: audioParam(), type: "", buffer: null, onended: null });
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; this.destination = audioNode(); }
  resume() {}
  createGain() { return audioNode(); }
  createOscillator() { return audioNode(); }
  createDelay() { return audioNode(); }
  createBufferSource() { return audioNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}
const sandbox = {
  console,
  document: {
    getElementById: (id) => (elCache[id] ||= makeEl()),
    createElement: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeEl(),
    documentElement: makeEl(),
  },
  navigator: {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { reload() {}, href: "" },
  // Music停止後もタイマーが残らないよう即時実行（Music自体は後で無効化する）
  setTimeout: (cb, ms, ...a) => { setImmediate(() => { try { cb(...a); } catch (e) { console.error("timer error:", e); } }); return 0; },
  clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  AudioContext: FakeAudioContext,
  innerWidth: 400, innerHeight: 700,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: (cb) => { setImmediate(cb); return 0; },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------- ゲームスクリプトのロード ---------- */
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
vm.runInContext(readFileSync(new URL("./pokedex-extra.js", import.meta.url), "utf8"), sandbox, { filename: "pokedex-extra.js" });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) { console.error("NG: <script> が見つからない"); process.exit(1); }
for (const src of scripts) vm.runInContext(src, sandbox, { filename: "index.html(inline)" });
console.log("OK: スクリプトのロード成功（構文エラーなし）");

/* ---------- テスト用オーバーライド ---------- */
vm.runInContext(`
  Music.play = () => {}; Music.stop = () => {};
  Object.keys(sfx).forEach((k) => { sfx[k] = () => {}; });
  say = async () => {};
  confirmDialog = async () => true;
  showPartyModal = async () => {
    const cur = battle.pIdx;
    return battle.playerParty.findIndex((m, i) => m.hp > 0 && i !== cur);
  };
  playerCommand = async () => {
    const p = battle.playerParty[battle.pIdx];
    const forced = p.charging || (p.locked && p.locked.moveKey);
    if (forced) { const slot = p.moves.find((s) => s.key === forced); if (slot) return { kind: "fight", slot, mega: false }; p.charging = null; p.locked = null; }
    let usable = p.moves.filter((m) => m.pp > 0);
    if (p.choiceLock) usable = usable.filter((m) => m.key === p.choiceLock);
    if (p.encore) usable = usable.filter((m) => m.key === p.encore.moveKey);
    if (p.item === "assaultvest") usable = usable.filter((m) => MOVES[m.key].cat !== "status");
    if (!usable.length) return { kind: "pass" };
    return { kind: "fight", slot: usable[Math.floor(Math.random() * usable.length)], mega: megaEligible(p, "player") };
  };
`, sandbox);

/* ---------- テストヘルパー ---------- */
let pass = 0, fail = 0;
sandbox.report = (name, ok, detail = "") => {
  if (ok) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  <- " + detail : "")); }
};
const run = (code) => vm.runInContext(`(async () => { ${code} })()`, sandbox, { filename: "test" });

vm.runInContext(`
  function setupDuel(aKey, bKey) {
    battle.playerParty = [makeMon(defaultEntry(aKey))];
    battle.enemyParty = [makeMon(defaultEntry(bKey))];
    battle.pIdx = 0; battle.eIdx = 0; battle.over = false;
    battle.weather = null; battle.weatherTurns = 0; battle.terrain = null; battle.terrainTurns = 0;
    battle.hazards = { player: {rocks:false,toxicspikes:0,spikes:0}, enemy: {rocks:false,toxicspikes:0,spikes:0} };
    battle.screens = { player: {reflect:0,lightscreen:0,auroraveil:0}, enemy: {reflect:0,lightscreen:0,auroraveil:0} };
    battle.trickroom = 0; battle.pendingPivot = null;
    battle.megaUsed = {player:false,enemy:false}; battle.fainted = {player:0,enemy:0}; battle.potions = {player:2,enemy:2};
    const [p, e] = [battle.playerParty[0], battle.enemyParty[0]];
    p.item = "none"; e.item = "none";
    return [p, e];
  }
  function giveMove(m, key) { m.moves = [{ key, pp: 20 }]; return m.moves[0]; }
`, sandbox);

/* ---------- 単体テスト ---------- */
await run(`
  const R = (v) => { Math.random = () => v; };
  const realRandom = Math.random;

  // 1) オボンのみ: 残りHP1/2以下になる残留ダメージでも発動する
  {
    const [p] = setupDuel("garchomp", "gengar");
    p.item = "sitrusberry";
    p.hp = Math.floor(p.maxHp * 0.55);
    await chip(p, "player", 1/8, "test");
    report("オボン: chip経由で発動", p.itemUsed && p.hp > Math.floor(p.maxHp * 0.55) - Math.floor(p.maxHp / 8));
  }

  // 2) イカサマ: 相手の攻撃実数値を参照する
  {
    R(0.5);
    const [p, e] = setupDuel("greninja", "azumarill");
    const mv = { ...MOVES.foulplay, key: "foulplay" };
    e.atk = 200;
    const dmgHigh = calcDamage(p, e, mv, false, "player");
    e.atk = 50;
    const dmgLow = calcDamage(p, e, mv, false, "player");
    report("イカサマ: 相手の攻撃力を参照", dmgHigh > dmgLow * 2, dmgHigh + " vs " + dmgLow);
  }

  // 3) ジャイロボール: 相手が速いほど威力UP
  {
    R(0.5);
    const [p, e] = setupDuel("metagross", "dragapult");
    const mv = { ...MOVES.gyroball, key: "gyroball" };
    p.spe = 40; e.spe = 200;
    calcDamage(p, e, mv, false, "player");
    report("ジャイロボール: 威力計算", mv.power >= 100 && mv.power <= 150, "power=" + mv.power);
  }

  // 4) まもる: 攻撃を無効化
  {
    const [p, e] = setupDuel("garchomp", "gengar");
    e.protected = true;
    const before = e.hp;
    await useMove(p, e, giveMove(p, "earthquake"), "player", null);
    report("まもる: ダメージ無効", e.hp === before);
  }

  // 5) みがわり: 本体を守る・変化技を防ぐ・壊れる
  {
    R(0.5);
    const [p, e] = setupDuel("raichu", "garchomp");
    e.atk = 30;   // みがわりが1発で壊れない弱さにする
    await useMove(p, e, giveMove(p, "substitute"), "player", null);
    const madeSub = p.sub > 0 && p.hp === p.maxHp - Math.floor(p.maxHp / 4);
    const hpAfterSub = p.hp;
    await useMove(e, p, giveMove(e, "dragonclaw"), "enemy", null);
    const subTook = p.hp === hpAfterSub && p.sub > 0;
    await useMove(e, p, giveMove(e, "willowisp"), "enemy", null);
    report("みがわり: 生成+攻撃肩代わり", madeSub && subTook, "sub=" + p.sub + " hp=" + p.hp + "/" + hpAfterSub);
    report("みがわり: 変化技を防ぐ", p.status === null);
  }

  // 6) リフレクター: 物理半減
  {
    R(0.5);
    const [p, e] = setupDuel("garchomp", "milotic");
    const mv = { ...MOVES.earthquake, key: "earthquake" };
    const noWall = calcDamage(p, e, mv, false, "player");
    battle.screens.enemy.reflect = 5;
    const withWall = calcDamage(p, e, mv, false, "player");
    report("リフレクター: 物理半減", withWall === Math.floor(noWall / 2) || Math.abs(withWall - noWall / 2) <= 1, noWall + " -> " + withWall);
  }

  // 7) どくどく: もうどくは毎ターン増加
  {
    const [p, e] = setupDuel("gengar", "milotic");
    R(0.1);
    await useMove(p, e, giveMove(p, "toxic"), "player", null);
    const isTox = e.status === "tox";
    const hp0 = e.hp;
    await endOfTurn();
    const d1 = hp0 - e.hp;
    const hp1 = e.hp;
    await endOfTurn();
    const d2 = hp1 - e.hp;
    report("どくどく: もうどく付与+増加ダメージ", isTox && d2 > d1, "d1=" + d1 + " d2=" + d2);
  }

  // 8) やどりぎのタネ: 吸収して相手が回復
  {
    const [p, e] = setupDuel("whimsicott", "garchomp");
    R(0.1);
    await useMove(p, e, giveMove(p, "leechseed"), "player", null);
    p.hp = Math.floor(p.maxHp / 2);
    const pBefore = p.hp, eBefore = e.hp;
    await endOfTurn();
    report("やどりぎ: 吸収+回復", e.leechSeed && e.hp < eBefore && p.hp > pBefore, "e:" + eBefore + "->" + e.hp + " p:" + pBefore + "->" + p.hp);
  }

  // 9) 一撃技: 命中すれば即KO / がんじょうは無効 / タイプ無効
  {
    R(0.1);
    const [p, e] = setupDuel("garchomp", "milotic");
    await useMove(p, e, giveMove(p, "fissure"), "player", null);
    report("じわれ: 一撃KO", e.hp === 0);
    const [p2, e2] = setupDuel("garchomp", "archaludon");
    e2.ability = "sturdy";
    await useMove(p2, e2, giveMove(p2, "fissure"), "player", null);
    report("じわれ: がんじょうで無効", e2.hp === e2.maxHp);
    const [p3, e3] = setupDuel("garchomp", "charizard");
    await useMove(p3, e3, giveMove(p3, "fissure"), "player", null);
    report("じわれ: ひこうタイプに無効", e3.hp === e3.maxHp);
  }

  // 10) カウンター: 受けた物理ダメージを2倍で返す
  {
    R(0.5);
    const [p, e] = setupDuel("annihilape", "garchomp");
    await useMove(e, p, giveMove(e, "dragonclaw"), "enemy", null);
    const taken = p.tookHit ? p.tookHit.dmg : 0;
    const eBefore = e.hp;
    await useMove(p, e, giveMove(p, "counter"), "player", null);
    report("カウンター: 2倍返し", taken > 0 && (eBefore - e.hp) === taken * 2, "taken=" + taken + " dealt=" + (eBefore - e.hp));
  }

  // 11) とんぼがえり: ダメージ後に交代
  {
    R(0.5);
    const [p, e] = setupDuel("greninja", "milotic");
    battle.playerParty.push(makeMon(defaultEntry("garchomp")));
    const eBefore = e.hp;
    await useMove(p, e, giveMove(p, "uturn"), "player", null);
    const flagged = battle.pendingPivot === "player";
    if (flagged) await doPivot("player");
    report("とんぼがえり: ダメージ+交代", eBefore > e.hp && flagged && battle.pIdx === 1, "pIdx=" + battle.pIdx);
  }

  // 12) ほろびのうた: 3ターン後に全滅
  {
    R(0.1);
    const [p, e] = setupDuel("gengar", "milotic");
    await useMove(p, e, giveMove(p, "perishsong"), "player", null);
    const counted = p.perish === 4 && e.perish === 4;
    // 使用ターンを含め4回のターン終了（カウント3→2→1→0）で全滅する
    await endOfTurn(); await endOfTurn(); await endOfTurn(); await endOfTurn();
    report("ほろびのうた: カウント+全滅", counted && battle.over, "over=" + battle.over);
  }

  // 13) あついしぼう: ほのお/こおり半減
  {
    R(0.5);
    const [p, e] = setupDuel("charizard", "azumarill");
    const mv = { ...MOVES.flamethrower, key: "flamethrower" };
    e.ability = "clearbody";   // マリルリの初期特性があついしぼうなので基準値用に外す
    const normal = calcDamage(p, e, mv, false, "player");
    e.ability = "thickfat";
    const halved = calcDamage(p, e, mv, false, "player");
    report("あついしぼう: 半減", halved <= Math.ceil(normal / 2), normal + " -> " + halved);
  }

  // 14) ふゆう: じめん無効
  {
    const [p, e] = setupDuel("garchomp", "gengar");
    e.ability = "levitate";
    const before = e.hp;
    await useMove(p, e, giveMove(p, "earthquake"), "player", null);
    report("ふゆう: じめん無効", e.hp === before);
  }

  // 15) ポイズンヒール: どくで回復
  {
    const [p] = setupDuel("gliscor", "milotic");
    p.ability = "poisonheal";
    p.status = "psn";
    p.hp = Math.floor(p.maxHp / 2);
    const before = p.hp;
    await endOfTurn();
    report("ポイズンヒール: 回復", p.hp > before, before + " -> " + p.hp);
  }

  // 16) ゆき+オーロラベール+ふぶき必中
  {
    const [p, e] = setupDuel("baxcalibur", "milotic");
    R(0.1);
    await useMove(p, e, giveMove(p, "snowscape"), "player", null);
    const snowed = battle.weather === "snow";
    await useMove(p, e, giveMove(p, "auroraveil"), "player", null);
    const veiled = battle.screens.player.auroraveil === 5;
    R(0.99);   // 命中70なら本来はずれる乱数
    const before = e.hp;
    await useMove(p, e, giveMove(p, "blizzard"), "player", null);
    report("ゆき: 天候+オーロラベール", snowed && veiled);
    report("ふぶき: ゆきで必中", e.hp < before);
  }

  // 17) ラムのみ: 状態異常を即回復
  {
    const [p] = setupDuel("garchomp", "milotic");
    p.item = "lumberry";
    await inflictStatus(p, "player", "brn", true);
    report("ラムのみ: 即回復", p.status === null && p.item === "none");
  }

  // 18) しろいハーブ: 能力ダウンを戻す
  {
    const [p] = setupDuel("garchomp", "milotic");
    p.item = "whiteherb";
    await applyStatChange(p, "player", "atk", -1);
    report("しろいハーブ: 復元", p.stages.atk === 0 && p.item === "none");
  }

  // 19) トリックルーム: 発動フラグ
  {
    const [p, e] = setupDuel("hatterene", "milotic");
    await useMove(p, e, giveMove(p, "trickroom"), "player", null);
    report("トリックルーム: 発動", battle.trickroom === 5);
  }

  // 20) 連続技: つららばり複数回ヒット
  {
    R(0.5);   // multi: 0.5 -> 3回
    const [p, e] = setupDuel("baxcalibur", "milotic");
    e.timesHit = 0;
    await useMove(p, e, giveMove(p, "iciclespear"), "player", null);
    report("つららばり: 3回ヒット", e.timesHit === 3, "timesHit=" + e.timesHit);
  }

  // 21) ブーストエナジー: 天候なしで発動
  {
    const [p] = setupDuel("fluttermane", "milotic");
    p.ability = "protosynthesis"; p.item = "boosterenergy";
    await onSwitchIn("player");
    report("ブーストエナジー: 発動", p.boosted && p.item === "none");
  }

  // 22) しおづけ: 継続ダメージ
  {
    R(0.5);
    const [p, e] = setupDuel("garganacl", "milotic");
    await useMove(p, e, giveMove(p, "saltcure"), "player", null);
    const marked = e.saltCured;
    const before = e.hp;
    await endOfTurn();
    report("しおづけ: 付与+みずタイプ1/4ダメージ", marked && (before - e.hp) >= Math.floor(e.maxHp / 4), "d=" + (before - e.hp));
  }

  Math.random = realRandom;
`);

/* ---------- ランダム自動対戦（クラッシュ検証） ---------- */
await run(`
  const keys = Object.keys(SPECIES);
  let done = 0, crashed = 0;
  for (let i = 0; i < 60; i++) {
    try {
      const pick = () => keys[Math.floor(Math.random() * keys.length)];
      const team = new Set(); while (team.size < 6) team.add(pick());
      const foes = new Set(); while (foes.size < 6) foes.add(pick());
      game.team = [...team];
      game.playerPicks = [0, 1, 2];
      game.enemyTeam = [...foes].map((k) => randomEnemyEntry(k));
      enemyAssignItems(game.enemyTeam);
      battle.playerParty = game.playerPicks.map((ix) => makeMon(game.builds[game.team[ix]]));
      battle.enemyParty = enemyPickThree();
      battle.pIdx = 0; battle.eIdx = 0; battle.potions = {player:2,enemy:2}; battle.over = false;
      battle.weather = null; battle.weatherTurns = 0; battle.terrain = null; battle.terrainTurns = 0;
      battle.hazards = { player: {rocks:false,toxicspikes:0,spikes:0}, enemy: {rocks:false,toxicspikes:0,spikes:0} };
      battle.screens = { player: {reflect:0,lightscreen:0,auroraveil:0}, enemy: {reflect:0,lightscreen:0,auroraveil:0} };
      battle.trickroom = 0; battle.pendingPivot = null;
      battle.megaUsed = {player:false,enemy:false}; battle.fainted = {player:0,enemy:0};
      await onSwitchIn("enemy"); await onSwitchIn("player");
      let turns = 0;
      while (!battle.over && ++turns < 250) await battleTurn();
      done++;
    } catch (e) {
      crashed++;
      console.log("  battle #" + i + " CRASH: " + e.stack.split("\\n").slice(0, 3).join(" | "));
    }
  }
  report("ランダム自動対戦60戦: クラッシュなし", crashed === 0, done + "戦完走 " + crashed + "クラッシュ");
`);

console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
