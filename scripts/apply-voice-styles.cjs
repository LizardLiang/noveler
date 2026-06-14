// One-off: write canon/derived 說話方式 (voice_style) for 鬥破蒼穹 project characters.
// Run with the noveler app CLOSED (sql.js rewrites the whole DB file on save):
//   node scripts/apply-voice-styles.cjs
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = 'C:/Users/shotu/OneDrive/novels/鬥破蒼穹/project.db';

const VOICE_STYLES = {
  '蕭炎':
    '對敵時「嘿」然冷笑、語帶譏誚；正式場合自稱「蕭某」，受讚則道「僥倖而已」；狠話擲地有聲（「三十年河東，三十年河西，莫欺少年窮」式）。外冷內熱、句子短而沉穩。絕不用現代詞彙，不說俏皮話，不在敵人面前示弱。',
  '藥老':
    '稱蕭炎等晚輩「小傢伙」，自稱「老夫」或「為師」。慈愛中帶戲謔調侃，點評世事雲淡風輕，談煉藥之道則嚴謹自負。絕不用現代詞彙。',
  '小醫仙':
    '直呼「蕭炎」之名（不用暱稱）。話少而含蓄，語氣輕柔沉靜，感情內斂從不直白表露；對外人疏離戒備，對敵冷漠決絕，溫婉醫者與冰冷「毒女」語氣可瞬間切換。絕不撒嬌、不長篇大論、不用現代用語。',
  '雲韻':
    '語氣淡然成熟，言辭端莊果決，自有宗主的鎮定；私下對親近之人溫柔細膩，常帶一絲無奈與輕嘆。絕不輕浮嬉鬧、不口出粗言、不用現代詞彙。',
  '美杜莎':
    '自稱「本皇」，言辭簡短如敕令，高傲冰冷、不屑解釋亦不容置疑；對在意之人口硬心軟，以冷哼與威脅掩飾關切。絕不低聲下氣、不用謙辭與現代用語。',
  '蕭薰兒':
    '喚「蕭炎哥哥」。溫婉得體、輕聲細語、善解人意；對外人疏離清冷，自有古族千金不容冒犯的矜持。絕不口出惡言、不大聲喧嘩、不用現代詞彙。',
  '蕭戰':
    '正直剛毅，帶一家之主的威嚴與豪邁，言談常以「我蕭家」榮辱為念；對蕭炎慈愛而驕傲，多鼓勵期許之語。絕不奴顏婢膝、不用現代用語。',
  '古元':
    '平和帶笑、不怒自威，平淡言談間彷彿洞察人心；以族長身分發言時凝重深遠、滴水不漏，對沈無妄與蕭炎帶長輩考校意味。絕不輕率失態、不用現代詞彙。',
  '風尊者':
    '言談瀟灑風趣、不拘小節，常以長輩口吻打趣調侃晚輩；觸及原則底線則語氣轉為霸道強硬。絕不迂腐說教、不用現代用語。',
  '沈無妄':
    '嘴欠愛講垃圾話，現代風格的玩笑是他的標誌——但一場戲最多一句，且多半出現在裝弱或翻盤的瞬間；其餘時候話少而平靜，越是危險語氣越懶散。對雲韻與小醫仙偶有收斂玩笑後的認真。',
  '妖岐':
    '軍人腔，簡短務實，恭敬而僵硬；稟報用語制式（「屬下不敢擅斷」「請示下」），從不開玩笑，從不多話。',
  '妖螟':
    '陰沉算計，語帶試探與威脅，慣用反問與譏諷；表面客氣，實則步步進逼。',
  '妖暝':
    '隱忍低沉，言辭簡短而帶舊王威嚴；談及族中叛亂時壓抑恨意，字句更冷。',
  '螟淵':
    '舊臣口吻，戒備沉穩；對妖暝執禮恭敬，對外族言語防備、惜字如金。',
  '妖羅':
    '陰冷傲慢，言語刻薄貪婪；對下蔑視輕慢，對妖螟卑順逢迎。',
  '妖螟親衛首領':
    '冷酷簡短，多為命令式語句；提及舊王一系時語帶蔑視。',
  '九幽地冥蟒族守谷老者':
    '沉默寡言，開口僅有警告與盤問，不寒暄、不解釋。',
  '蘇辰':
    '冷酷寡言，言語簡短直接，不帶情緒。',
};

(async () => {
  const sqlJsPath = require.resolve('sql.js');
  const SQL = await initSqlJs({ locateFile: () => path.join(path.dirname(sqlJsPath), 'sql-wasm.wasm') });
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(new Uint8Array(buf));

  let updated = 0;
  for (const [name, style] of Object.entries(VOICE_STYLES)) {
    const stmt = db.prepare('UPDATE characters SET voice_style=?, updated_at=? WHERE name=?');
    stmt.run([style, new Date().toISOString(), name]);
    stmt.free();
    const check = db.exec(`SELECT changes()`);
    const changes = check[0]?.values?.[0]?.[0] ?? 0;
    if (changes > 0) {
      updated++;
      console.log(`updated: ${name}`);
    } else {
      console.log(`NOT FOUND: ${name}`);
    }
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log(`\n${updated}/${Object.keys(VOICE_STYLES).length} characters updated, DB saved.`);
})();
