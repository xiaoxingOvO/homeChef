// 云函数入口文件
const cloud = require('wx-server-sdk')
const SEED_RECIPES = require('./seedRecipes')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const SEED_BATCH_SIZE = 50

const DEFAULT_CATEGORIES = [
  { name: '荤菜', isSystem: false, order: 0 },
  { name: '素菜', isSystem: false, order: 1 },
  { name: '汤', isSystem: false, order: 2 },
  { name: '主食', isSystem: false, order: 3 },
  { name: '凉菜', isSystem: false, order: 4 },
  { name: '小吃', isSystem: false, order: 5 },
  { name: '其他', isSystem: true, order: 6 },
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
  await addMany('categories', DEFAULT_CATEGORIES.map((cat) => ({
    ...cat,
    _openid: openid,
    createdAt: now,
  })))

  for (let i = 0; i < SEED_RECIPES.length; i += SEED_BATCH_SIZE) {
    const batch = SEED_RECIPES.slice(i, i + SEED_BATCH_SIZE)
    const docs = batch.map((dish, index) => ({
      ...dish,
      _openid: openid,
      seedOrder: i + index,
      createdAt: new Date(now.getTime() + i + index),
      updatedAt: now,
    }))
    await addMany('dishes', docs)
  }

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
    dishes: SEED_RECIPES.length,
    emojis: CUSTOM_EMOJIS.length,
  }
}

async function addMany(collectionName, docs) {
  if (docs.length === 0) return
  await Promise.all(
    docs.map((doc) => db.collection(collectionName).add({ data: doc }))
  )
}
