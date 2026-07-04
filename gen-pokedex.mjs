// PokeAPI からポケモンデータを取得して pokedex-extra.js を生成する
// よくある型（ポケ徹風）ロジック: 物理型は物理技・特殊型は特殊技を採用、
// 速いアタッカーはS振り、耐久型はHP振りでS振りしない
import { writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { execSync } from "child_process";

// ゲーム本体から MOVES 辞書を抽出（カテゴリ・威力・タイプを参照）
const html = readFileSync("pokemon-battle.html", "utf8");
const movesSrc = html.match(/const MOVES = \{[\s\S]*?\n\};/)[0];
const MOVES = new Function(movesSrc + "; return MOVES;")();
const gameMoveSet = new Set(Object.keys(MOVES));
const MOVE_EXCEPTIONS = { "sandstorm": "sandstormmove", "will-o-wisp": "willowisp", "rain-dance": "raindance", "sunny-day": "sunnyday" };
function toGameMove(apiName) {
  if (MOVE_EXCEPTIONS[apiName]) return MOVE_EXCEPTIONS[apiName];
  const k = apiName.replace(/-/g, "");
  return gameMoveSet.has(k) ? k : null;
}

const TARGETS = [
  ["pelipper", "pelipper"], ["whimsicott", "whimsicott"], ["excadrill", "excadrill"],
  ["arcanine", "arcanine"], ["azumarill", "azumarill"], ["salamence", "salamence"],
  ["hydreigon", "hydreigon"], ["volcarona", "volcarona"], ["gliscor", "gliscor"],
  ["clefable", "clefable"], ["weavile", "weavile"], ["scizor", "scizor"],
  ["gyarados", "gyarados"], ["hippowdon", "hippowdon"], ["heatran", "heatran"],
  ["ferrothorn", "ferrothorn"], ["corviknight", "corviknight"], ["grimmsnarl", "grimmsnarl"],
  ["dondozo", "dondozo"], ["annihilape", "annihilape"], ["glimmora", "glimmora"],
  ["sneasler", "sneasler"], ["baxcalibur", "baxcalibur"], ["rotom-wash", "rotom-wash"],
  ["landorus-therian", "landorus-therian"], ["roaring-moon", "roaringmoon"],
  ["dragapult", "dragapult"], ["mawile", "mawile"], ["garganacl", "garganacl"],
  ["talonflame", "talonflame"], ["breloom", "breloom"], ["krookodile", "krookodile"],
  ["quaquaval", "quaquaval"], ["skeledirge", "skeledirge"], ["serperior", "serperior"],
  ["cinderace", "cinderace"], ["primarina", "primarina"], ["togekiss", "togekiss"],
  ["gardevoir", "gardevoir"], ["hatterene", "hatterene"], ["clodsire", "clodsire"],
  ["mamoswine", "mamoswine"], ["chandelure", "chandelure"], ["milotic", "milotic"],
  ["kommo-o", "kommoo"], ["goodra", "goodra"], ["ceruledge", "ceruledge"],
  ["armarouge", "armarouge"], ["great-tusk", "greattusk"], ["iron-treads", "irontreads"],
  ["iron-moth", "ironmoth"], ["iron-hands", "ironhands"],
];

const ABILITY_MAP = {
  "rough-skin": "roughskin", "intimidate": "intimidate", "drizzle": "drizzle", "drought": "drought",
  "sand-stream": "sandstream", "swift-swim": "swiftswim", "adaptability": "adaptability",
  "clear-body": "clearbody", "sturdy": "sturdy", "guts": "guts", "huge-power": "hugepower", "unaware": "unaware",
  "magic-bounce": "magicbounce", "toxic-debris": "toxicdebris", "contrary": "contrary",
  "no-guard": "noguard", "static": "static", "reckless": "reckless", "multiscale": "multiscale",
  "defiant": "defiant", "justified": "justified", "protean": "protean", "pixilate": "pixilate",
  "tough-claws": "toughclaws", "supreme-overlord": "supremeoverlord", "protosynthesis": "protosynthesis",
  "inner-focus": "innerfocus", "sand-force": "sandforce", "stamina": "stamina",
  "good-as-gold": "goodasgold", "disguise": "disguise", "blaze": "blaze", "torrent": "torrent",
  "overgrow": "overgrow", "solar-power": "solarpower", "cursed-body": "cursedbody",
  "shadow-tag": "shadowtag", "electric-surge": "electricsurge", "unseen-fist": "unseenfist",
};

// フォルム違いの表示名（種名だけだと区別できないもの）
const NAME_OVERRIDE = { "rotom-wash": "ウォッシュロトム", "landorus-therian": "れいじゅうランドロス" };

const get = async (url) => (await fetch(url)).json();
const out = {}, extraAbilities = {};

for (const [api, img] of TARGETS) {
  try {
    const p = await get(`https://pokeapi.co/api/v2/pokemon/${api}`);
    const sp = await get(p.species.url);
    const ja = NAME_OVERRIDE[api] || (sp.names.find((n) => n.language.name === "ja-Hrkt") || sp.names.find((n) => n.language.name === "ja") || { name: api }).name;
    const statOf = (n) => p.stats.find((s) => s.stat.name === n).base_stat;
    const base = [statOf("hp"), statOf("attack"), statOf("defense"), statOf("special-attack"), statOf("special-defense"), statOf("speed")];
    const types = p.types.map((t) => t.type.name);
    const abilities = [];
    for (const a of p.abilities) {
      const key = ABILITY_MAP[a.ability.name];
      if (key) { if (!abilities.includes(key)) abilities.push(key); }
      else {
        const ak = a.ability.name.replace(/-/g, "");
        if (!extraAbilities[ak]) {
          const ad = await get(a.ability.url);
          const aja = (ad.names.find((n) => n.language.name === "ja-Hrkt") || ad.names.find((n) => n.language.name === "ja") || { name: a.ability.name }).name;
          extraAbilities[ak] = { name: aja, desc: "(効果は未実装)" };
        }
        if (!abilities.includes(ak)) abilities.push(ak);
      }
    }
    // 実装済みとくせいを先頭に（デフォルト採用されるため）
    abilities.sort((a, b) => (extraAbilities[a] ? 1 : 0) - (extraAbilities[b] ? 1 : 0));
    // ---- よくある型ロジック ----
    const [hp, atk, def, spa, spd, spe] = base;
    const physical = atk >= spa || abilities.includes("hugepower");
    const pool = [...new Set(p.moves.map((m) => toGameMove(m.move.name)).filter(Boolean))];
    const attacks = pool.filter((m) => MOVES[m].cat !== "status");
    if (attacks.length < 4) { console.log(`SKIP ${api}: attacks=${attacks.length}`); continue; }
    // 採用スコア: 威力 × タイプ一致1.5 × カテゴリ一致（不一致は0.4倍で基本除外）
    const score = (m) => {
      const mv = MOVES[m];
      const stab = types.includes(mv.type) ? 1.5 : 1;
      const catFit = (mv.cat === "phys") === physical ? 1 : 0.4;
      return (mv.power || 0) * stab * catFit;
    };
    attacks.sort((a, b) => score(b) - score(a));
    const STATUS_PRIORITY = ["dragondance","quiverdance","swordsdance","nastyplot","bellydrum","calmmind","bulkup","irondefense","recover","slackoff","roost","stealthrock","willowisp","thunderwave","raindance","sunnyday","yawn","encore","roar","sandstormmove"];
    const pri = (m) => { const i = STATUS_PRIORITY.indexOf(m); return i < 0 ? 99 : i; };
    const statusMoves = pool.filter((m) => MOVES[m].cat === "status").sort((a, b) => pri(a) - pri(b));
    let trimmed = attacks.slice(0, 10).concat(statusMoves.slice(0, 4));
    // とんぼがえり/ボルトチェンジは定番なので必ず入れる
    ["uturn","voltswitch"].forEach((pv) => { if (pool.includes(pv) && !trimmed.includes(pv)) trimmed.push(pv); });
    // 配分: 攻/特攻/素早さ型はS振り、HP/防/特防型はHP振り
    const offScore = Math.max(atk, spa) + spe;
    const bulkScore = hp + (def + spd) / 2;
    const investSpe = spe >= 85 || (spe >= 70 && offScore > bulkScore + 40);
    const atkStat = physical ? "atk" : "spa";
    const defPts = investSpe
      ? { [atkStat]: 32, spe: 32, hp: 2 }
      : { [atkStat]: 32, hp: 32, [physical ? "spd" : "def"]: 2 };
    const defNature = physical ? (investSpe ? "jolly" : "adamant") : (investSpe ? "timid" : "modest");
    const defItem = investSpe ? (physical ? "lifeorb" : "choicespecs") : "leftovers";
    // スプライト
    for (const suffix of ["", "-back"]) {
      const f = `sprites/${img}${suffix}.gif`;
      if (!existsSync(f) || statSync(f).size < 5000) {
        try { execSync(`curl.exe -sL -o "${f}" "https://play.pokemonshowdown.com/sprites/${suffix ? "ani-back" : "ani"}/${img}.gif"`); } catch (e) {}
      }
    }
    if (!existsSync(`sprites/${img}.gif`) || statSync(`sprites/${img}.gif`).size < 5000) { console.log(`SKIP ${api}: no sprite`); continue; }
    const key = api.replace(/-/g, "");
    out[key] = { name: ja, types, base, abilities, pool: trimmed, defPts, defItem, defNature, img };
    console.log(`OK ${api} -> ${ja} [${physical ? "物理" : "特殊"}${investSpe ? "・S振り" : "・HP振り"}] top4: ${attacks.slice(0,4).map(m=>MOVES[m].name).join("/")}`);
  } catch (e) {
    console.log(`FAIL ${api}: ${e.message}`);
  }
}

const js = `// 自動生成: gen-pokedex.mjs (PokeAPI)\nwindow.EXTRA_ABILITIES = ${JSON.stringify(extraAbilities)};\nwindow.EXTRA_SPECIES = ${JSON.stringify(out)};\n`;
writeFileSync("pokedex-extra.js", js);
console.log(`\nwrote pokedex-extra.js: ${Object.keys(out).length} species`);
