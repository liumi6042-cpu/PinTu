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
  onigiri: {
    id: 'onigiri',
    name: '海苔饭团',
    slot: 'food',
    price: 3,
    hours: [3, 5],
    icon: './assets/icons/onigiri.webp',
    trait: 'town',
    shortDesc: '短途轻快 · 3~5 小时归家',
    flavor: '奶奶常包的海苔饭团，适合去镇口溜达一圈。',
    treatTarget: 'apang',
  },
  bento: {
    id: 'bento',
    name: '鱼肉便当',
    slot: 'food',
    price: 8,
    hours: [6, 10],
    icon: './assets/icons/bento.webp',
    trait: 'water',
    shortDesc: '水边与猫友最爱 · 6~10 小时',
    flavor: '烤得香喷喷的小鱼便当，走到哪儿都容易交到猫朋友。',
    treatTarget: 'apang',
  },
  osmanthus: {
    id: 'osmanthus',
    name: '桂花甜糕',
    slot: 'food',
    price: 10,
    hours: [8, 14],
    icon: './assets/icons/osmanthus.webp',
    trait: 'street',
    shortDesc: '怀旧旧闻加成 · 8~14 小时',
    flavor: '拾光镇老字号的桂花糕，带着奶奶店里的甜香。',
    treatTarget: 'grandpa',
  },
  camera: {
    id: 'camera',
    name: '旧胶片相机',
    slot: 'tool',
    price: 14,
    permanent: true,
    icon: './assets/icons/camera.webp',
    trait: 'wild',
    shortDesc: '永久器物 · 旅伴合影概率提升',
    flavor: '柜台抽屉里翻出的老相机，总能定格意想不到的瞬间。',
  },
  umbrella: {
    id: 'umbrella',
    name: '油纸小雨伞',
    slot: 'tool',
    price: 12,
    permanent: true,
    icon: './assets/icons/umbrella.webp',
    trait: 'street',
    shortDesc: '永久器物 · 雨夜旧巷事件加成',
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
    shortDesc: '心愿信物 · 倾向拜访大橘阿胖',
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
    shortDesc: '心愿信物 · 倾向前往月光水族馆',
    flavor: '慢慢送的小玻璃瓶，夜里会泛出柔和海蓝光。',
  },
  'wish-grandma': {
    id: 'wish-grandma',
    name: '奶奶的旧邮票',
    slot: 'wish',
    price: 6,
    permanent: true,
    icon: './assets/icons/envelope.webp',
    trait: 'town',
    npcId: 'grandpa',
    shortDesc: '心愿信物 · 寻访拾光镇旧闻',
    flavor: '夹在拼图盒里的老邮票，带着它容易听见福爷爷讲过去的事。',
  },
};

export const SYNERGIES = [
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
    region: 'water',
    src: './assets/postcards/misty-lake.webp',
    line: '雨刚停，湖面亮晶晶的。我把旧布包放在木栈道上，坐着等日出差点打起盹来。',
    hiddenNote: '显影后记：栈道尽头捡到了一只听得见潮声的小贝壳。',
    pieces: 9,
    npcId: 'manman',
    seasonTag: '十月 · 初秋晨雾',
  },
  'rainy-bookshop': {
    id: 'rainy-bookshop',
    title: '旧书巷的雨夜屋檐',
    place: '旧书巷',
    region: 'street',
    src: './assets/postcards/rainy-bookshop.webp',
    line: '雨停之前，我和大橘阿胖躲在旧书店屋檐下，把两条小鱼干平分啦。',
    hiddenNote: '显影后记：书店老板还顺手把蓝边油纸伞支在了我们身旁。',
    pieces: 9,
    npcId: 'apang',
    seasonTag: '十一月 · 小雨',
  },
  'starry-camp': {
    id: 'starry-camp',
    title: '寒星下的松果营地',
    place: '星空营地',
    region: 'wild',
    src: './assets/postcards/starry-camp.webp',
    line: '山上的星星比奶奶店里的拼图块还多。我对着划过的流星许了个愿：愿你早点回家。',
    hiddenNote: '显影后记：帐篷里的马灯整夜都没熄，萤火虫绕着领巾飞了一圈。',
    pieces: 9,
    npcId: 'gugu',
    seasonTag: '十一月 · 寒星营地',
  },
  'breakfast-street': {
    id: 'breakfast-street',
    title: '飘在云端的早餐街',
    place: '早餐街',
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
