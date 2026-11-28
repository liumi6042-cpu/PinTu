// 「团子去旅行 2.0」绘本世界静态目录与真实公历节气配置

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

const CN_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const CN_DAYS = [
  '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十', '卅一',
];

/** 按真实公历月份映射拾光镇季节与气候（方案 A：真实公历四季） */
export function getCalendarInfo(ts) {
  const d = new Date(ts);
  const m = d.getMonth() + 1; // 1..12
  const day = d.getDate();
  const h = d.getHours();

  let season = 'autumn';
  let seasonLabel = '初秋';
  let defaultWeather = 'sun';

  if (m >= 3 && m <= 5) {
    season = 'spring';
    seasonLabel = m === 3 ? '初春' : m === 4 ? '仲春' : '暮春';
    defaultWeather = day % 3 === 0 ? 'rain' : 'sakura';
  } else if (m >= 6 && m <= 8) {
    season = 'summer';
    seasonLabel = m === 6 ? '初夏' : m === 7 ? '盛夏' : '晚夏';
    defaultWeather = h >= 19 || h < 5 ? 'firefly' : 'sun';
  } else if (m >= 9 && m <= 10) {
    season = 'autumn';
    seasonLabel = m === 9 ? '早秋' : day <= 22 ? '初秋' : '深秋';
    defaultWeather = day % 4 === 0 ? 'rain' : 'autumn';
  } else {
    // 11 月中旬起进入初冬雪季，12-2 月深冬
    if (m === 11 && day < 10) {
      season = 'autumn';
      seasonLabel = '晚秋';
      defaultWeather = day % 2 === 0 ? 'rain' : 'autumn';
    } else {
      season = 'winter';
      seasonLabel = m === 11 ? '初冬' : m === 12 ? '仲冬' : '深冬';
      defaultWeather = 'snow';
    }
  }

  let period = '午后';
  let isNight = false;
  if (h >= 5 && h < 10) period = '清晨';
  else if (h >= 10 && h < 14) period = '正午';
  else if (h >= 14 && h < 18) period = '午后';
  else if (h >= 18 && h < 20) { period = '傍晚'; isNight = true; }
  else { period = '雪夜'; isNight = true; }
  if (isNight && season !== 'winter') period = h >= 18 && h < 20 ? '黄昏' : '夜里';

  const cnDate = `${CN_MONTHS[m - 1]}${CN_DAYS[day] || `${day}日`}`;
  const shortDate = `${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weatherLabel = {
    sun: '晴',
    autumn: '晴风',
    rain: '小雨',
    snow: '飘雪',
    sakura: '樱风',
    firefly: '夏夜',
  }[defaultWeather] || '晴';

  return {
    year: d.getFullYear(),
    month: m,
    day,
    hour: h,
    season,
    seasonLabel,
    period,
    isNight,
    defaultWeather,
    weatherLabel,
    cnDate,
    shortDate,
    plaqueSub: `${seasonLabel}${isNight ? (season === 'winter' ? '雪夜' : '夜') : period} · ${weatherLabel}`,
  };
}

export const ITEMS = {
  fish: {
    id: 'fish',
    name: '香酥小鱼干',
    slot: 'food',
    price: 25,
    hours: [2, 4],
    icon: './assets/icons/fish.webp',
    trait: 'water',
    shortDesc: '猫零食 · 投喂或短途',
    flavor: '窗台晒得酥香的小鱼干，既能直接喂给团子解馋，也是阿胖最爱。',
    treatTarget: 'apang',
    isSnack: true,
  },
  onigiri: {
    id: 'onigiri',
    name: '海苔饭团',
    slot: 'food',
    price: 20,
    hours: [3, 5],
    icon: './assets/icons/onigiri.webp',
    trait: 'town',
    shortDesc: '3~5 小时 · 短途轻快',
    flavor: '奶奶常包的海苔饭团，适合去镇口溜达一圈。',
    treatTarget: 'apang',
  },
  bento: {
    id: 'bento',
    name: '鱼肉便当',
    slot: 'food',
    price: 45,
    hours: [6, 10],
    icon: './assets/icons/bento.webp',
    trait: 'water',
    shortDesc: '6~10 小时 · 易遇猫友',
    flavor: '烤得香喷喷的小鱼便当，走到哪儿都容易交到猫朋友。',
    treatTarget: 'apang',
  },
  osmanthus: {
    id: 'osmanthus',
    name: '桂花甜糕',
    slot: 'food',
    price: 60,
    hours: [8, 14],
    icon: './assets/icons/osmanthus.webp',
    trait: 'street',
    shortDesc: '8~14 小时 · 怀旧旧闻',
    flavor: '拾光镇老字号的桂花糕，带着奶奶店里的甜香。',
    treatTarget: 'grandpa',
  },
  camera: {
    id: 'camera',
    name: '旧胶片相机',
    slot: 'tool',
    price: 150,
    permanent: true,
    icon: './assets/icons/camera.webp',
    trait: 'wild',
    shortDesc: '永久 · 旅伴合影提升',
    flavor: '柜台抽屉里翻出的老相机，总能定格意想不到的瞬间。',
  },
  umbrella: {
    id: 'umbrella',
    name: '油纸小雨伞',
    slot: 'tool',
    price: 120,
    permanent: true,
    icon: './assets/icons/umbrella.webp',
    trait: 'street',
    shortDesc: '永久 · 雨夜旧巷加成',
    flavor: '蓝白渐变的旧油纸伞，下雨天撑开格外温柔。',
  },
  'token-apang': {
    id: 'token-apang',
    name: '伞约信物',
    slot: 'wish',
    price: 0,
    permanent: true,
    icon: './assets/icons/umbrella.webp',
    trait: 'street',
    npcId: 'apang',
    shortDesc: '信物 · 倾向拜访阿胖',
    flavor: '阿胖挠过一角的旧纸笺，带上它团子会绕去旧书巷找它。',
  },
  'token-manman': {
    id: 'token-manman',
    name: '微光水母瓶',
    slot: 'wish',
    price: 0,
    permanent: true,
    icon: './assets/icons/jellyfish.webp',
    trait: 'water',
    npcId: 'manman',
    shortDesc: '信物 · 前往月光馆',
    flavor: '慢慢送的小玻璃瓶，夜里会泛出柔和海蓝光。',
  },
  'wish-grandma': {
    id: 'wish-grandma',
    name: '奶奶旧邮票',
    slot: 'wish',
    price: 80,
    permanent: true,
    icon: './assets/icons/envelope.webp',
    trait: 'town',
    npcId: 'grandpa',
    shortDesc: '心愿信物 · 寻访旧闻',
    flavor: '夹在拼图盒里的老邮票，带着它容易听见福爷爷讲过去的事。',
  },
};

export const SYNERGIES = [
  {
    id: 'fish-umbrella',
    food: 'fish',
    tool: 'umbrella',
    whisper: '酥香小鱼干配油纸伞，旧书巷屋檐下阿胖闻着味就来了',
    cardId: 'rainy-bookshop',
    npcId: 'apang',
  },
  {
    id: 'bento-camera',
    food: 'bento',
    tool: 'camera',
    whisper: '便当配旧相机，似乎容易拍到和伙伴同行的瞬间',
    cardId: 'rainy-bookshop',
    npcId: 'apang',
  },
  {
    id: 'bento-umbrella',
    food: 'bento',
    tool: 'umbrella',
    whisper: '鱼香混着雨气，旧书巷屋檐下或许正有人避雨',
    cardId: 'rainy-bookshop',
    npcId: 'apang',
  },
  {
    id: 'osmanthus-camera',
    food: 'osmanthus',
    tool: 'camera',
    whisper: '甜糕与旧相机，也许能拍下早餐街点亮灯笼的一刻',
    cardId: 'breakfast-street',
    npcId: 'grandpa',
  },
  {
    id: 'osmanthus-umbrella',
    food: 'osmanthus',
    tool: 'umbrella',
    whisper: '桂花香配油纸伞，适合去云上邮局听雨声',
    cardId: 'cloud-post',
    npcId: 'gugu',
  },
  {
    id: 'onigiri-camera',
    food: 'onigiri',
    tool: 'camera',
    whisper: '轻装带饭团和相机，正好赶上雾湖清晨第一缕光',
    cardId: 'misty-lake',
    npcId: 'manman',
  },
];

export function matchSynergy(pack) {
  if (!pack?.food) return null;
  const hit = SYNERGIES.find(s => s.food === pack.food && (!s.tool || s.tool === pack.tool));
  if (hit) return hit;
  if (pack.wish === 'token-apang') {
    return { id: 'wish-apang', whisper: '带着旧书巷伞约，团子多半会拐去屋顶找大橘阿胖', cardId: 'rainy-bookshop', npcId: 'apang' };
  }
  if (pack.wish === 'token-manman') {
    return { id: 'wish-manman', whisper: '水母瓶微微发亮，团子似乎想再去海边看看慢慢', cardId: 'moon-aquarium', npcId: 'manman' };
  }
  if (pack.wish === 'wish-grandma') {
    return { id: 'wish-grandma', whisper: '旧邮票有奶奶的温度，团子会去早餐街和邮局转转', cardId: 'breakfast-street', npcId: 'grandpa' };
  }
  return null;
}

export const NPCS = {
  apang: {
    id: 'apang',
    name: '大橘阿胖',
    role: '旧书巷屋顶霸主',
    portrait: './assets/uikit/portrait-apang.webp',
    postmark: '旧书巷',
    scribe: '咕咕局长代笔',
    stageTitles: ['尚未相识', '巷口初遇', '屋顶熟客', '小窝常客', '形影不离'],
    letters: [
      {
        step: 1,
        salutation: '小店的主人：',
        body: '今天在旧书巷屋檐下碰见你家那只三花猫了。它居然想分我半条小鱼干——哼，看在下雨的份上我才勉强收下的。',
        sign: '—— 屋顶的阿胖  按爪',
        choices: [
          { id: 'share-roof', label: '「屋顶瓦片分它一半吧」', bonusNpc: 'apang', memory: '托咕咕带话给阿胖，请它分半片屋顶给团子晒太阳。' },
          { id: 'promise-bento', label: '「下次带热鱼肉便当给你」', bonusNpc: 'apang', memory: '答应下次让团子带鱼肉便当去找阿胖。' },
        ],
      },
      {
        step: 2,
        salutation: '小店的主人：',
        body: '你再不回来，你家三花猫就要学会我那套翻瓦片绝活了。不过它天天蹲在窗台上往坡道下面望，怪吵的。等雪停了，记得早点开门。',
        sign: '—— 屋顶的阿胖  按爪',
        choices: [
          { id: 'bring-fish', label: '「下次带热鱼肉便当给你」', bonusNpc: 'apang', memory: '约好了雪停之后请阿胖来小店吃烤鱼便当。' },
          { id: 'stay-cushion', label: '「角落蒲团留给你午睡」', bonusNpc: 'apang', memory: '把小窝角落的圆蒲团正式留给了阿胖。' },
        ],
      },
    ],
  },
  grandpa: {
    id: 'grandpa',
    name: '福爷爷',
    role: '早餐街包子铺',
    portrait: './assets/uikit/portrait-grandpa.webp',
    postmark: '早餐街',
    scribe: '阿福代笔',
    stageTitles: ['尚未相识', '蒸笼相逢', '早餐街熟人', '老友记挂', '一家之亲'],
    letters: [
      {
        step: 1,
        salutation: '小禾丫头：',
        body: '你家团子清早就蹲在包子铺蒸笼底下闻香味，跟当年跟着你奶奶来买早点时一模一样。我给它留了半个没放葱的温包子边，别担心它饿着。',
        sign: '—— 早餐街 福爷爷',
        choices: [
          { id: 'thanks-grandpa', label: '「替我谢谢爷爷和阿福」', bonusNpc: 'grandpa', memory: '托信感谢福爷爷在清晨照顾爱嘴馋的团子。' },
          { id: 'ask-recipe', label: '「想听奶奶教捏褶子的故事」', bonusNpc: 'grandpa', memory: '和福爷爷约好有空再听他讲奶奶当年的旧事。' },
        ],
      },
    ],
  },
  gugu: {
    id: 'gugu',
    name: '咕咕局长',
    role: '云上邮局送信人',
    portrait: './assets/uikit/portrait-gugu.webp',
    postmark: '云上邮局',
    scribe: '亲自执笔',
    stageTitles: ['尚未相识', '按址投递', '云上送信人', '红绳捆信人', '专属邮差'],
    letters: [
      {
        step: 1,
        salutation: '奶奶小店收：',
        body: '近日来往小店的明信片渐渐多起来了，咕。你出门忙碌那阵子，我怕信箱塞不下，便用邮局的红丝带替你整整齐齐扎成了信捆放在门边凳子上。',
        sign: '—— 云上邮局 咕咕',
        choices: [
          { id: 'leave-tea', label: '「窗台给你留了桂花糕」', bonusNpc: 'gugu', memory: '在窗台招待碟给辛勤送信的咕咕局长留了点心。' },
          { id: 'keep-ribbon', label: '「红丝带我会好好收着」', bonusNpc: 'gugu', memory: '把咕咕局长系信捆的红丝带夹进了手账里。' },
        ],
      },
    ],
  },
  manman: {
    id: 'manman',
    name: '慢慢',
    role: '月光水族馆看馆人',
    portrait: './assets/uikit/portrait-manman.webp',
    postmark: '月光海湾',
    scribe: '水母灯下写成',
    stageTitles: ['尚未相识', '水族馆初遇', '气泡同行', '海底挚友', '星海守望'],
    letters: [
      {
        step: 1,
        salutation: '小禾你好：',
        body: '团子今天踩着拼图泡泡来看水母了……它一开始有点炸毛，后来盯着发蓝光的贝壳看了好久。我替它装了一小瓶柔和的海水微光，天冷的时候放在木架上会很安心。',
        sign: '—— 月光水族馆 慢慢',
        choices: [
          { id: 'visit-again', label: '「天暖了我们一起去看海」', bonusNpc: 'manman', memory: '和慢慢约好来年开春再带团子去看发光水母。' },
          { id: 'hang-bottle', label: '「水母瓶已经摆在顶层木架」', bonusNpc: 'manman', memory: '把慢慢送的水母玻璃瓶摆上了小窝最亮眼的木架。' },
        ],
      },
    ],
  },
};

export const POSTCARD_POOL = {
  'grandma-shop': {
    id: 'grandma-shop',
    title: '奶奶小店的清晨',
    place: '奶奶小店门口',
    postmark: '拾光镇',
    region: 'town',
    src: './assets/postcards/grandma-shop.webp',
    line: '今天在门口坡道回头看了一眼，阳光照进小店的时候，真像奶奶还在柜台后面。',
    hiddenNote: '显影后记：门框上还留着小禾五岁时画的身高刻痕。',
    pieces: 9,
    npcId: 'grandpa',
    seasonTag: '初秋',
  },
  'misty-lake': {
    id: 'misty-lake',
    title: '雾湖码头的金光',
    place: '雾湖码头',
    postmark: '雾湖岸',
    region: 'water',
    src: './assets/postcards/misty-lake.webp',
    line: '雨刚停，湖面亮晶晶的。我把旧布包放在木栈道上，坐着等日出差点打起盹来。',
    hiddenNote: '显影后记：栈道尽头捡到了一只听得见潮声的小贝壳。',
    pieces: 9,
    npcId: 'manman',
    seasonTag: '十月 · 雾湖',
  },
  'rainy-bookshop': {
    id: 'rainy-bookshop',
    title: '旧书巷的雨夜屋檐',
    place: '旧书巷',
    postmark: '旧书巷',
    region: 'street',
    src: './assets/postcards/rainy-bookshop.webp',
    line: '雨停之前，我和大橘阿胖躲在旧书店屋檐下，把两条小鱼干平分啦。',
    hiddenNote: '显影后记：书店老板还顺手把蓝边油纸伞支在了我们身旁。',
    pieces: 9,
    npcId: 'apang',
    seasonTag: '十一月 · 雨巷',
  },
  'starry-camp': {
    id: 'starry-camp',
    title: '寒星下的松果营地',
    place: '星空营地',
    postmark: '松果林',
    region: 'wild',
    src: './assets/postcards/starry-camp.webp',
    line: '山上的星星比奶奶店里的拼图块还多。我对着划过的流星许了个愿：愿你早点回家。',
    hiddenNote: '显影后记：帐篷里的马灯整夜都没熄，萤火虫绕着领巾飞了一圈。',
    pieces: 9,
    npcId: 'gugu',
    seasonTag: '十一月 · 寒星',
  },
  'breakfast-street': {
    id: 'breakfast-street',
    title: '飘在云端的早餐街',
    place: '早餐街',
    postmark: '早餐街',
    region: 'street',
    src: './assets/postcards/breakfast-street.webp',
    line: '闻着十八个褶子的肉包香走了三条街，福爷爷笑着把刚出笼的包子边分了我一块。',
    hiddenNote: '显影后记：蒸笼热气里，隐约写着奶奶当年留给福爷爷的旧菜谱。',
    pieces: 9,
    npcId: 'grandpa',
    seasonTag: '初秋 · 烟火',
  },
  'cloud-post': {
    id: 'cloud-post',
    title: '云上邮局的纸鹤',
    place: '云上邮局',
    postmark: '云邮局',
    region: 'town',
    src: './assets/postcards/cloud-post.webp',
    line: '咕咕局长让我坐在分拣室窗台上盖邮戳，每一封写给你的信我都按了小爪印。',
    hiddenNote: '显影后记：角落里那封粉色花朵封口的信，原来一直在等小禾长大。',
    pieces: 9,
    npcId: 'gugu',
    seasonTag: '晚秋 · 云端',
  },
  'moon-aquarium': {
    id: 'moon-aquarium',
    title: '沉在海底的月光馆',
    place: '月光水族馆',
    postmark: '月光湾',
    region: 'water',
    src: './assets/postcards/moon-aquarium.webp',
    line: '拼图泡泡带着我慢慢沉进海里，水母像一盏盏蓝灯，慢慢轻声说好久没这么热闹了。',
    hiddenNote: '显影后记：大贝壳深处闪烁的光，正是拼图小窝故事开始的地方。',
    pieces: 9,
    npcId: 'manman',
    seasonTag: '初冬 · 月海',
  },
};

export const SOUVENIRS = {
  windchime: {
    id: 'windchime',
    name: '贝壳风铃',
    icon: './assets/icons/windchime.webp',
    region: 'water',
    slotName: '顶层木架',
    originText: '蓝湾灯塔退潮时拾得的贝壳串成',
    agedDays: 14,
    agedNote: '起风时团子总爱抬头拨它，像是还记着海湾的潮声。',
  },
  sailboat: {
    id: 'sailboat',
    name: '小木船',
    icon: './assets/icons/sailboat.webp',
    region: 'water',
    slotName: '顶层木架',
    originText: '雾湖码头老木匠随手削给团子的小帆船',
    agedDays: 14,
    agedNote: '摆了半月后，船帆上不知何时多了团子按下的淡淡爪印。',
  },
  jellyfish: {
    id: 'jellyfish',
    name: '微光水母瓶',
    icon: './assets/icons/jellyfish.webp',
    region: 'water',
    slotName: '最高层架顶',
    originText: '月光水族馆慢慢赠予的夜光小玻璃瓶',
    agedDays: 10,
    agedNote: '每到雪夜熄灯，它就会在小窝最高处轻轻映出一圈海蓝微光。',
  },
  'red-scarf': {
    id: 'red-scarf',
    name: '冬日红绒围巾',
    icon: './assets/uikit/wax-paw.webp',
    region: 'street',
    slotName: '团子穿戴',
    originText: '离开三十日那场初雪，福爷爷与阿胖替团子凑来的暖绒围巾',
    agedDays: 7,
    agedNote: '围巾扣上别着一枚旧车站铜徽章，团子现在天一冷就自己叼出来戴。',
  },
};

export const PERSONALITIES = {
  water: { seal: '听风小旅猫', desc: '偏爱海风与水雾，近来学会了自己拨响风铃' },
  street: { seal: '雨巷食客猫', desc: '熟悉每一条热气腾腾的街巷，和屋顶阿胖成了莫逆' },
  wild: { seal: '山野观星猫', desc: '喜欢在松果林和星空下发呆，眼睛里装着银河' },
  town: { seal: '恋家暖团子', desc: '绕再远的路，最牵挂的还是奶奶小店窗台那缕光' },
};

export const PET_WHISPERS = {
  autumn: [
    '呼噜呼噜……午后的阳光晒得肚皮暖烘烘的。',
    '喵～今天要给我往蓝布包里装什么好吃的呀？',
    '刚才有一片秋叶贴在窗玻璃上，我盯了它好久。',
  ],
  winter: [
    '喵！外面在下雪，屋里亮着台灯真暖和。',
    '呼噜……这条红绒围巾暖极了，你要摸摸看吗？',
    '阿胖在角落打呼噜呢，你小声一点别吵醒它呀。',
  ],
  spring: [
    '喵～风里飘来樱花瓣了，我想再去雾湖码头看看！',
    '呼噜呼噜……窗台的藤蔓又抽出两片新嫩叶啦。',
  ],
  summer: [
    '夜里窗外有萤火虫一闪一闪的，像会飞的拼图块。',
    '喵～给我装一份鱼肉便当吧，海边的风一定很凉快！',
  ],
  away: [
    '坐垫上留着一张小爪印纸条：团子正在路上，晚些带故事回来。',
  ],
};

/* =========================================================
   小窝原地融合装扮目录（方式一：同视角原地手绘羽化贴片 + 整猫融合穿搭）
   所有房间槽位坐标均按 768×1376 原画原生百分比精准锁定，零贴纸漂移！
   ========================================================= */
export const DECOR_SLOTS = [
  { id: 'desk',    label: '桌面台灯', short: '台灯',   tab: 'desk',   box: { left: 0.4,  top: 40.5, width: 16.5, height: 19.2 } },
  { id: 'window',  label: '窗框挂饰', short: '窗饰',   tab: 'window', box: { left: 10.5, top: 18.5, width: 29.0, height: 22.8 } },
  { id: 'shelf1L', label: '顶层木架·左', short: '顶架左', tab: 'shelf',  box: { left: 45.0, top: 21.8, width: 17.5, height: 10.2 } },
  { id: 'shelf1R', label: '顶层木架·右', short: '顶架右', tab: 'shelf',  box: { left: 63.0, top: 23.6, width: 15.5, height: 8.5 } },
  { id: 'shelf2L', label: '中层书架·左', short: '中架左', tab: 'shelf',  box: { left: 45.8, top: 32.0, width: 15.5, height: 9.2 } },
  { id: 'shelf2R', label: '中层书架·右', short: '中架右', tab: 'shelf',  box: { left: 61.5, top: 32.2, width: 17.0, height: 9.0 } },
  { id: 'shelf3',  label: '下层展格',   short: '展格',   tab: 'window', box: { left: 46.5, top: 41.6, width: 32.6, height: 9.4 } },
  { id: 'outfit',  label: '团子穿搭',   short: '穿搭',   tab: 'outfit', box: { left: 37.0, top: 51.4, width: 24.5, height: 13.0 } },
];

export const DECOR_ITEMS = {
  // 1. 左侧桌面台灯（带真实光晕色温联动）
  'lamp-mushroom': {
    id: 'lamp-mushroom',
    slot: 'desk',
    name: '彩绘蘑菇台灯',
    slotLabel: '左侧木桌台灯位',
    patch: './assets/decor/lamp-mushroom.webp',
    thumb: './assets/decor/thumb-lamp-mushroom.webp',
    rect: { left: 0.0, top: 40.698, width: 16.667, height: 19.041 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    lampGlow: 'amber',
    story: '奶奶年轻时从旧货集市淘来的琥珀琉璃台灯，摆上木桌后，雪夜会映出一圈蜜色柔光。',
  },
  'lamp-lantern': {
    id: 'lamp-lantern',
    slot: 'desk',
    name: '煤油复古小马灯',
    slotLabel: '左侧木桌台灯位',
    patch: './assets/decor/lamp-lantern.webp',
    thumb: './assets/decor/thumb-lamp-lantern.webp',
    rect: { left: 0.0, top: 42.006, width: 12.5, height: 17.733 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    lampGlow: 'candle',
    story: '星空营地同款老黄铜马灯，灯芯摇曳着温润的烛火，最适合下雪天陪团子打盹。',
  },

  // 2. 窗框挂饰
  'win-teru': {
    id: 'win-teru',
    slot: 'window',
    name: '晴天布偶挂饰',
    slotLabel: '阳光窗框挂饰位',
    patch: './assets/decor/win-teru.webp',
    thumb: './assets/decor/thumb-win-teru.webp',
    rect: { left: 11.979, top: 18.895, width: 12.24, height: 12.936 },
    source: '小窝初始珍藏',
    starter: true,
    story: '小禾用旧手帕扎成的晴天布偶，系在阳光木窗上，祈愿团子出门都遇好天气。',
  },
  'win-windchime': {
    id: 'win-windchime',
    slot: 'window',
    name: '海湾贝壳风铃',
    slotLabel: '阳光窗框挂饰位',
    patch: './assets/decor/win-windchime.webp',
    thumb: './assets/decor/thumb-win-windchime.webp',
    rect: { left: 27.865, top: 18.605, width: 11.719, height: 16.279 },
    source: '旅途带回 / 摇奖',
    gachaGold: true,
    souvenirLink: 'windchime',
    interactive: 'windchime',
    story: '蓝湾退潮时拾得的贝壳串成，起风时轻碰一下就会发出清脆的五声海风响。',
  },
  'win-herbs': {
    id: 'win-herbs',
    slot: 'window',
    name: '薰衣草干花束',
    slotLabel: '阳光窗框挂饰位',
    patch: './assets/decor/win-herbs.webp',
    thumb: './assets/decor/thumb-win-herbs.webp',
    rect: { left: 11.198, top: 19.331, width: 22.396, height: 21.948 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '扎着草绿丝带的薰衣草与尤加利干花，窗外晒进阳光时，整间小窝都飘着淡淡草木香。',
  },

  // 3. 顶层木架·左
  's1l-jellyfish': {
    id: 's1l-jellyfish',
    slot: 'shelf1L',
    name: '微光水母瓶',
    slotLabel: '顶层木架·左格',
    patch: './assets/decor/s1l-jellyfish.webp',
    thumb: './assets/decor/thumb-s1l-jellyfish.webp',
    rect: { left: 45.052, top: 21.802, width: 16.406, height: 10.029 },
    source: '旅途带回 / 摇奖',
    gachaGold: true,
    souvenirLink: 'jellyfish',
    jellyGlow: true,
    story: '月光水族馆慢慢赠予的夜光小玻璃瓶，暗处会在深胡桃木壁上泛出一圈海蓝微光。',
  },
  's1l-teapot': {
    id: 's1l-teapot',
    slot: 'shelf1L',
    name: '奶奶旧陶茶壶',
    slotLabel: '顶层木架·左格',
    patch: './assets/decor/s1l-teapot.webp',
    thumb: './assets/decor/thumb-s1l-teapot.webp',
    rect: { left: 45.052, top: 24.419, width: 18.229, height: 7.413 },
    source: '小窝初始珍藏',
    starter: true,
    story: '温润的红陶茶壶配一只小茶杯，以前奶奶每次拼完一幅大图，总会泡上一壶热桂花茶。',
  },

  // 4. 顶层木架·右
  's1r-musicbox': {
    id: 's1r-musicbox',
    slot: 'shelf1R',
    name: '三花猫八音盒',
    slotLabel: '顶层木架·右格',
    patch: './assets/decor/s1r-musicbox.webp',
    thumb: './assets/decor/thumb-s1r-musicbox.webp',
    rect: { left: 63.281, top: 24.564, width: 14.583, height: 7.267 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    interactive: 'musicbox',
    story: '胡桃木黄铜八音盒里躺着一只打盹的小三花，轻点木盒就会叮叮咚咚流出一小段摇篮曲。',
  },
  's1r-camera': {
    id: 's1r-camera',
    slot: 'shelf1R',
    name: '双反旧胶片机',
    slotLabel: '顶层木架·右格',
    patch: './assets/decor/s1r-camera.webp',
    thumb: './assets/decor/thumb-s1r-camera.webp',
    rect: { left: 63.021, top: 24.273, width: 16.146, height: 7.558 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '磨出温柔铜光的旧双反相机，团子不出远门的时候，它就静静守在顶层木架上。',
  },

  // 5. 中层书架·左
  's2l-vase': {
    id: 's2l-vase',
    slot: 'shelf2L',
    name: '干花陶土花瓶',
    slotLabel: '中层书架·左格',
    patch: './assets/decor/s2l-vase.webp',
    thumb: './assets/decor/thumb-s2l-vase.webp',
    rect: { left: 46.354, top: 32.267, width: 15.104, height: 8.866 },
    source: '小窝初始珍藏',
    starter: true,
    story: '奶白釉小瓷壶插着黄金球与紫薰衣草，让旧木书架多了一抹明快的秋日色彩。',
  },
  's2l-globe': {
    id: 's2l-globe',
    slot: 'shelf2L',
    name: '复古木座地球仪',
    slotLabel: '中层书架·左格',
    patch: './assets/decor/s2l-globe.webp',
    thumb: './assets/decor/thumb-s2l-globe.webp',
    rect: { left: 46.875, top: 32.413, width: 14.062, height: 8.721 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '团子总爱用鼻尖把小地球仪拨得慢悠悠转圈，大概是在挑下一趟想去的海湾吧。',
  },

  // 6. 中层书架·右
  's2r-sailboat': {
    id: 's2r-sailboat',
    slot: 'shelf2R',
    name: '雾湖小木船',
    slotLabel: '中层书架·右格',
    patch: './assets/decor/s2r-sailboat.webp',
    thumb: './assets/decor/thumb-s2r-sailboat.webp',
    rect: { left: 61.719, top: 32.413, width: 16.146, height: 8.721 },
    source: '旅途带回 / 摇奖',
    gachaGold: true,
    souvenirLink: 'sailboat',
    story: '雾湖码头老木匠随手削给团子的帆船模型，船帆上还留着淡淡的湖雾味道。',
  },
  's2r-journals': {
    id: 's2r-journals',
    slot: 'shelf2R',
    name: '火漆手账叠本',
    slotLabel: '中层书架·右格',
    patch: './assets/decor/s2r-journals.webp',
    thumb: './assets/decor/thumb-s2r-journals.webp',
    rect: { left: 60.938, top: 33.576, width: 18.229, height: 7.558 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '用细麻绳与朱砂火漆封好的旧手账叠本，里面夹满了拾光镇四个季节的压花标本。',
  },

  // 7. 下层展格
  's3-map': {
    id: 's3-map',
    slot: 'shelf3',
    name: '拾光镇地图与旧书',
    slotLabel: '下层木柜展格',
    patch: './assets/decor/s3-map.webp',
    thumb: './assets/decor/thumb-s3-map.webp',
    rect: { left: 46.875, top: 41.86, width: 32.552, height: 9.012 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '装在橡木框里的手绘拾光镇坡道地图，旁边靠着三本翻旧了的布面童话绘本。',
  },
  's3-keepsakes': {
    id: 's3-keepsakes',
    slot: 'shelf3',
    name: '弹珠罐与瓷猫罗盘',
    slotLabel: '下层木柜展格',
    patch: './assets/decor/s3-keepsakes.webp',
    thumb: './assets/decor/thumb-s3-keepsakes.webp',
    rect: { left: 46.875, top: 42.442, width: 32.292, height: 8.43 },
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '装着幸运彩木珠的玻璃罐、一只白瓷睡猫摆件和一枚老黄铜罗盘，是小窝最安心的角落。',
  },

  // 8. 团子穿搭（整猫融合重绘，零贴纸帽！）
  'outfit-default': {
    id: 'outfit-default',
    slot: 'outfit',
    name: '奶奶旧绿领巾',
    slotLabel: '团子穿搭',
    thumb: './assets/decor/thumb-outfit-default.webp',
    napSprite: './assets/cat/tuanzi-nap.webp',
    waitSprite: './assets/cat/tuanzi-wait.webp',
    source: '小窝初始穿搭',
    starter: true,
    story: '奶奶亲手系在团子脖子上的鼠尾草绿棉布小领巾，柔软又透气。',
  },
  'outfit-postman': {
    id: 'outfit-postman',
    slot: 'outfit',
    name: '云邮局小圆帽',
    slotLabel: '团子穿搭',
    thumb: './assets/decor/thumb-outfit-postman.webp',
    napSprite: './assets/cat/tuanzi-nap-postman.webp',
    waitSprite: './assets/cat/tuanzi-wait-postman.webp',
    source: '摇奖·暖金珍品',
    gachaGold: true,
    story: '咕咕局长特制的迷你邮差帽，帽檐镶着黄铜飞信徽章，戴上它睡觉都像在云端送信。',
  },
  'outfit-redscarf': {
    id: 'outfit-redscarf',
    slot: 'outfit',
    name: '冬日红绒围巾',
    slotLabel: '团子穿搭',
    thumb: './assets/decor/thumb-outfit-redscarf.webp',
    napSprite: './assets/cat/tuanzi-nap-redscarf.webp',
    waitSprite: './assets/cat/tuanzi-wait-redscarf.webp',
    source: '重逢赠礼 / 摇奖',
    gachaGold: true,
    story: '粗针手织的陶红毛线围巾，别着一枚旧铜扣，下雪天把小爪子缩进去暖极了。',
  },
};

/** 6 套手绘实景小窝场景（4 套同视角四季室内 + 1 套初冬雪夜重逢 + 1 套后院落日木廊户外新视角） */
export const ROOM_SCENES = [
  {
    id: 'autumn-day',
    name: '初秋午后',
    fullTitle: '初秋午后 · 奶奶旧小店',
    badge: '可自由摆件',
    bg: './assets/rooms/day1-nocat.webp',
    thumb: './assets/rooms/thumb-scene-autumn.webp',
    layout: 'plate',
    supportsDecor: true,
    defaultWeather: 'autumn',
    windowMode: 'plate',
    lampGlow: null,
    hasJellyGlow: false,
    hasApang: false,
    actorClass: '',
    whisper: '午后的阳光暖烘烘的，团子正在垫子上打盹。',
    story: '刚搬进奶奶旧小店的初秋午后，7 处木架与左桌皆可原地自由摆件装扮。',
  },
  {
    id: 'spring-sakura',
    name: '仲春樱窗',
    fullTitle: '仲春樱窗 · 落樱茶香',
    badge: '仲春实景',
    bg: './assets/rooms/room-sakura.webp',
    thumb: './assets/rooms/thumb-scene-sakura.webp',
    layout: 'plate',
    supportsDecor: false,
    defaultWeather: 'sakura',
    windowMode: 'plate',
    lampGlow: null,
    hasJellyGlow: false,
    hasApang: false,
    actorClass: '',
    whisper: '窗外粉樱随晨风飘落，青瓷茶壶里刚泡好一壶春茶。',
    story: '三四月间，老樱花枝探到木格窗外，清晨柔粉阳光斜洒在团子的绿花垫上。',
  },
  {
    id: 'rainy-alley',
    name: '雨巷听雨',
    fullTitle: '雨巷听雨 · 氤氲茶灯',
    badge: '雨日实景',
    bg: './assets/rooms/room-rain.webp',
    thumb: './assets/rooms/thumb-scene-rain.webp',
    layout: 'plate',
    supportsDecor: false,
    defaultWeather: 'rain',
    windowMode: 'plate',
    lampGlow: 'rain-amber',
    hasJellyGlow: false,
    hasApang: false,
    actorClass: '',
    whisper: '细雨敲打着旧木窗格，彩绘台灯暖烘烘的，门口立着油纸伞。',
    story: '雨天里的旧书巷雾气朦胧，点起彩绘台灯、捧杯热茶，最适合陪团子听雨。',
  },
  {
    id: 'summer-firefly',
    name: '盛夏萤夜',
    fullTitle: '盛夏萤夜 · 竹帘晚风',
    badge: '夏夜实景',
    bg: './assets/rooms/room-firefly.webp',
    thumb: './assets/rooms/thumb-scene-firefly.webp',
    layout: 'plate',
    supportsDecor: false,
    defaultWeather: 'firefly',
    windowMode: 'plate-firefly',
    lampGlow: 'firefly-lantern',
    hasJellyGlow: true,
    hasApang: false,
    actorClass: '',
    whisper: '夏夜竹帘外萤火点点，玻璃风铃随晚风轻轻摇晃。',
    story: '仲夏夜里挂起旧竹帘与玻璃风铃，桌上是冰麦茶与蒲扇，水母瓶泛着海蓝微光。',
  },
  {
    id: 'sunset-veranda',
    name: '落日木廊',
    fullTitle: '落日木廊 · 橘海小院',
    badge: '户外新视角',
    bg: './assets/rooms/room-veranda.webp',
    thumb: './assets/rooms/thumb-scene-veranda.webp',
    layout: 'cover',
    supportsDecor: false,
    defaultWeather: 'autumn',
    windowMode: 'veranda',
    lampGlow: 'veranda-lantern',
    hasJellyGlow: false,
    hasApang: false,
    actorClass: 'scene-veranda',
    whisper: '后院木廊浸在橘子海落日里，海风吹得贝壳风铃叮当响。',
    story: '奶奶小店后院的木质走廊，面朝拾光镇日落港湾与远方灯塔，摆着桂花糕茶几。',
  },
  {
    id: 'winter-snow',
    name: '初冬雪夜',
    fullTitle: '初冬雪夜 · 暖灯重逢',
    badge: '雪夜重逢',
    bg: './assets/rooms/day30-nocat.webp',
    thumb: './assets/rooms/thumb-scene-winter.webp',
    layout: 'cover',
    supportsDecor: false,
    defaultWeather: 'snow',
    windowMode: 'evolved',
    lampGlow: 'evolved-amber',
    hasJellyGlow: true,
    hasApang: true,
    actorClass: 'in-evolved',
    whisper: '窗外飘着微雪，阿胖在角落蹭午睡，屋里暖融融的。',
    story: '入冬飘雪后的成长小窝：绿藤攀窗开出冬花，大橘阿胖也成了角落蒲团的常客。',
  },
];

export const ROOM_SCENE_MAP = Object.fromEntries(ROOM_SCENES.map(s => [s.id, s]));

export const GACHA_CONFIG = {
  singleCoins: 60,
  fiveCoins: 280,
  pityMax: 5,
  balls: {
    gold:  { id: 'gold',  name: '暖金木珠', icon: './assets/icons/ball-gold.webp',  badge: '暖金珍品', desc: '限定摆件 / 团子穿搭' },
    red:   { id: 'red',   name: '朱砂红珠', icon: './assets/icons/ball-red.webp',   badge: '朱砂稀礼', desc: '心愿信物 / 秘境茶点' },
    blue:  { id: 'blue',  name: '青瓷蓝珠', icon: './assets/icons/ball-blue.webp',  badge: '青瓷手信', desc: '节气手工口粮礼盒' },
    green: { id: 'green', name: '松绿木珠', icon: './assets/icons/ball-green.webp', badge: '松绿零嘴', desc: '香酥小鱼干零食 ×3' },
  },
  redPool: [
    { id: 'red-grandma-stamp', name: '奶奶旧邮票礼笺', itemId: 'wish-grandma', bonusItem: 'osmanthus', bonusQty: 1, icon: './assets/icons/envelope.webp', story: '夹在老邮册里的旧邮票与一盒桂花甜糕，带去寻访拾光镇旧闻。' },
    { id: 'red-manman-bottle', name: '月光海湾邀约签', itemId: 'token-manman', bonusItem: 'bento', bonusQty: 1, icon: './assets/icons/jellyfish.webp', story: '慢慢托潮水寄来的海湾邀约与热腾腾鱼肉便当。' },
    { id: 'red-express-treat', name: '拾光秘境点心匣', itemId: 'osmanthus', qty: 2, bonusTicket: 1, icon: './assets/icons/osmanthus.webp', story: '桂花甜糕 ×2 再加赠 1 张旅途副券，福爷爷说好东西要成双。' },
  ],
  bluePool: [
    { id: 'blue-bento', name: '现烤鱼肉便当 ×2', itemId: 'bento', qty: 2, icon: './assets/icons/bento.webp', story: '刚出锅还冒着香气的鱼肉便当，出门最容易交到猫友。' },
    { id: 'blue-osmanthus', name: '老字号桂花甜糕 ×2', itemId: 'osmanthus', qty: 2, icon: './assets/icons/osmanthus.webp', story: '装在油纸袋里的桂花甜糕，甜而不腻，团子一路闻着香味走。' },
    { id: 'blue-onigiri', name: '海苔饭团旅行包 ×3', itemId: 'onigiri', qty: 3, icon: './assets/icons/onigiri.webp', story: '三枚饱满的海苔饭团，足够填满玄关的备品篮啦。' },
  ],
  greenPool: [
    { id: 'green-fish-3', name: '香酥小鱼干零食 ×3', itemId: 'fish', qty: 3, icon: './assets/icons/fish.webp', story: '窗台晒得金黄酥脆的小鱼干，立刻拿去喂团子或招待阿胖吧！' },
  ],
};
