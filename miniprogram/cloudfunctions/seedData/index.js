// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_CATEGORIES = [
  { name: '荤菜', isSystem: false, order: 0 },
  { name: '素菜', isSystem: false, order: 1 },
  { name: '汤', isSystem: false, order: 2 },
  { name: '主食', isSystem: false, order: 3 },
  { name: '凉菜', isSystem: false, order: 4 },
  { name: '小吃', isSystem: false, order: 5 },
  { name: '其他', isSystem: true, order: 6 },
]

const SAMPLE_DISHES = [
  { name: '红烧肉', category: '荤菜', emoji: '🍖', stars: 5, count: 0, image: '', steps: ['五花肉切块', '冷水下锅焯水', '炒糖色', '小火炖煮40分钟', '大火收汁'], note: '妈妈做的最好吃 ❤️' },
  { name: '可乐鸡翅', category: '荤菜', emoji: '🍗', stars: 4, count: 0, image: '', steps: ['鸡翅划刀', '腌制30分钟', '煎至两面金黄', '加可乐收汁'], note: '' },
  { name: '番茄炒蛋', category: '素菜', emoji: '🍅', stars: 5, count: 0, image: '', steps: ['鸡蛋打散加盐', '番茄切块', '先炒蛋盛出', '炒番茄出汁', '合并翻炒'], note: '' },
  { name: '蒜蓉青菜', category: '素菜', emoji: '🥬', stars: 4, count: 0, image: '', steps: ['青菜洗净沥干', '蒜蓉爆香', '大火快速翻炒', '盐调味出锅'], note: '' },
  { name: '紫菜蛋花汤', category: '汤', emoji: '🍲', stars: 4, count: 0, image: '', steps: ['水烧开', '加入紫菜', '淋入蛋液', '盐香油调味'], note: '' },
  { name: '饺子', category: '主食', emoji: '🥟', stars: 4, count: 0, image: '', steps: ['和面醒面', '猪肉白菜调馅', '擀皮包饺子', '开水下锅煮'], note: '' },
  { name: '凉拌黄瓜', category: '凉菜', emoji: '🥒', stars: 4, count: 0, image: '', steps: ['黄瓜拍碎切段', '蒜泥醋生抽调汁', '拌匀', '冷藏10分钟'], note: '' },
  { name: '煎饼果子', category: '小吃', emoji: '🌯', stars: 4, count: 0, image: '', steps: ['调面糊', '摊薄饼', '打蛋抹匀', '刷酱卷料'], note: '' },
  { name: '麻婆豆腐', category: '素菜', emoji: '🌶️', stars: 5, count: 0, image: '', steps: ['豆腐切块焯水', '炒肉末', '加豆瓣酱炒红油', '加豆腐炖煮收汁'], note: '' },
  { name: '蛋炒饭', category: '主食', emoji: '🍚', stars: 4, count: 0, image: '', steps: ['隔夜饭打散', '鸡蛋炒散', '葱花爆香', '混合翻炒调味'], note: '' },
  { name: '宫保鸡丁', category: '荤菜', emoji: '🐔', stars: 4, count: 0, image: '', steps: ['鸡丁腌制', '花生炒香', '爆炒鸡丁', '宫保汁调味'], note: '' },
  { name: '糖醋排骨', category: '荤菜', emoji: '🦴', stars: 5, count: 0, image: '', steps: ['排骨焯水', '炒糖色', '加醋酱油炖煮', '收汁至浓稠'], note: '' },
  { name: '酸辣土豆丝', category: '素菜', emoji: '🥔', stars: 4, count: 0, image: '', steps: ['土豆切细丝泡水', '热油爆香花椒辣椒', '大火快炒', '醋盐调味'], note: '' },
  { name: '西红柿牛腩汤', category: '汤', emoji: '🍲', stars: 5, count: 0, image: '', steps: ['牛腩焯水', '西红柿炒出汁', '一起炖煮1小时', '加盐调味'], note: '' },
]

// 50 个快捷图标
const CUSTOM_EMOJIS = [
  '🍖', '🍗', '🥩', '🐟', '🐔', '🦐', '🦀', '🥓', '🍤', '🐠',
  '🍅', '🥬', '🥔', '🥒', '🥦', '🌶️', '🥕', '🌽', '🧄', '🧅',
  '🍚', '🍜', '🥟', '🍞', '🥖', '🥐', '🍕', '🍔', '🌮', '🌯',
  '🍲', '🥘', '🥣', '🍛',
  '🥗', '🥚', '🍳', '🧀', '🍪', '🍰', '🧁', '🥠',
  '🥛', '🍵', '☕',
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍑', '🍉',
]

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  // 云端测试时 OPENID 为空，用测试ID；正式调用时用真实 openid
  const openid = wxContext.OPENID || event.userInfo?.openId || 'test_user'

  const [catRes, dishRes, settingsRes] = await Promise.all([
    db.collection('categories').where({ _openid: openid }).count(),
    db.collection('dishes').where({ _openid: openid }).count(),
    db.collection('user_settings').where({ _openid: openid }).limit(1).get(),
  ])

  const settings = settingsRes.data[0]
  if (settings?.seedInitialized === true) {
    return { message: '已初始化，跳过', openid }
  }

  // 兼容之前已经手动初始化或已经创建过数据的用户：只补上标记，不再重复插入示例数据。
  if (catRes.total > 0 || dishRes.total > 0) {
    if (settings?._id) {
      await db.collection('user_settings').doc(settings._id).update({
        data: {
          seedInitialized: true,
          seedInitializedAt: new Date(),
        },
      })
    } else {
      await db.collection('user_settings').add({
        data: {
          _openid: openid,
          customEmojis: CUSTOM_EMOJIS,
          seedInitialized: true,
          seedInitializedAt: new Date(),
        },
      })
    }
    return { message: '已有数据，跳过示例数据初始化', openid }
  }

  const now = new Date()
  await Promise.all([
    ...DEFAULT_CATEGORIES.map((cat) =>
      db.collection('categories').add({ data: { ...cat, _openid: openid, createdAt: now } })
    ),
    ...SAMPLE_DISHES.map((dish) =>
      db.collection('dishes').add({ data: { ...dish, _openid: openid, createdAt: now, updatedAt: now } })
    ),
  ])

  const seedSettings = {
    customEmojis: CUSTOM_EMOJIS,
    seedInitialized: true,
    seedInitializedAt: new Date(),
  }
  if (settings?._id) {
    await db.collection('user_settings').doc(settings._id).update({ data: seedSettings })
  } else {
    await db.collection('user_settings').add({
      data: { _openid: openid, ...seedSettings },
    })
  }

  return {
    message: '初始化完成',
    openid,
    categories: DEFAULT_CATEGORIES.length,
    dishes: SAMPLE_DISHES.length,
    emojis: CUSTOM_EMOJIS.length,
  }
}
