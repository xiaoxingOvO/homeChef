/**
 * 工具函数
 */

/** 获取今日日期 YYYY-MM-DD */
export function getToday(): string {
  const d = new Date()
  return formatDate(d)
}

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

/** 格式化日期显示  M月D日 */
export function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr)
  return d.getMonth() + 1 + '月' + d.getDate() + '日'
}

/** 获取星期几 */
export function getWeekday(dateStr: string): string {
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const d = new Date(dateStr)
  return weekdays[d.getDay() === 0 ? 6 : d.getDay() - 1]
}

/** 判断是否今天 */
export function isToday(dateStr: string): boolean {
  return dateStr === getToday()
}

/** 获取某周起始日期（周一） */
export function getWeekStart(offset: number = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + offset * 7)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d
}

/** 推荐图标库 */
export const RECOMMENDED_EMOJIS: string[] = [
  '🍖','🍗','🥩','🐟','🐠','🐔','🦐','🦀','🦞','🦑','🐙','🦪','🥓','🍤','🦴','🐷','🐮','🐑',
  '🍅','🥬','🥔','🥒','🥦','🧅','🧄','🌶️','🫑','🥕','🌽','🍆','🫘','🥜','🍄','🫒','🥑',
  '🍚','🍜','🍝','🥟','🍞','🥖','🥐','🥨','🥯','🧇','🥞','🍕','🍔','🌭','🌮','🌯','🥪','🍙','🍘','🍢','🍡',
  '🍲','🫕','🥘','🍛','🍿','🥣',
  '🥗','🥒','🥚','🧀','🥜','🍪','🍩','🍰','🧁','🍿','🥠',
  '🍳','🥚','🫘',
  '🍎','🍊','🍋','🍇','🍓','🫐','🍑','🥝','🍌','🍉','🥭','🍍',
  '🥛','🍵','☕','🧃','🥤','🧋',
  '🧂','🫙','🍯','🧈',
]

/** Emoji 描述映射（用于搜索） */
export function getEmojiDesc(emoji: string): string {
  const map: Record<string, string> = {
    '🍖':'肉','🍗':'鸡腿','🥩':'牛排','🐟':'鱼','🐠':'鱼','🐔':'鸡','🦐':'虾','🦀':'蟹','🦞':'龙虾','🦑':'鱿鱼','🐙':'章鱼','🦪':'生蚝','🥓':'培根','🍤':'虾仁','🦴':'骨头','🐷':'猪','🐮':'牛','🐑':'羊',
    '🍅':'番茄','🥬':'青菜','🥔':'土豆','🥒':'黄瓜','🥦':'西兰花','🧅':'洋葱','🧄':'蒜','🌶️':'辣椒','🫑':'青椒','🥕':'胡萝卜','🌽':'玉米','🍆':'茄子','🫘':'豆子','🥜':'花生','🍄':'蘑菇','🫒':'橄榄','🥑':'牛油果',
    '🍚':'米饭','🍜':'面条','🍝':'意面','🥟':'饺子','🍞':'面包','🥖':'法棍','🥐':'牛角包','🥯':'贝果','🧇':'华夫','🥞':'松饼','🍕':'披萨','🍔':'汉堡','🌭':'热狗','🌮':'taco','🌯':'卷饼','🥪':'三明治','🍙':'饭团','🍘':'仙贝','🍢':'关东煮','🍡':'团子',
    '🍲':'火锅','🫕':'芝士锅','🥘':'炖菜','🍛':'咖喱','🍿':'爆米花','🥣':'碗',
    '🥗':'沙拉','🥚':'蛋','🧀':'奶酪','🍪':'饼干','🍩':'甜甜圈','🍰':'蛋糕','🧁':'纸杯蛋糕','🥠':'fortune cookie',
    '🍳':'煎蛋','🥛':'牛奶','🍵':'茶','☕':'咖啡','🧃':'果汁','🥤':'饮料','🧋':'奶茶',
    '🧂':'盐','🫙':'罐子','🍯':'蜂蜜','🧈':'黄油',
    '🍎':'苹果','🍊':'橙子','🍋':'柠檬','🍇':'葡萄','🍓':'草莓','🫐':'蓝莓','🍑':'桃子','🥝':'猕猴桃','🍌':'香蕉','🍉':'西瓜','🥭':'芒果','🍍':'菠萝',
  }
  return map[emoji] || ''
}

// 默认图标
export const DEFAULT_EMOJIS: string[] = [
  '🍖','🍗','🥩','🐟','🐔','🦐','🦀','🥓','🍤','🐠',
  '🍅','🥬','🥔','🥒','🥦','🌶️','🥕','🌽','🧄','🧅',
  '🍚','🍜','🥟','🍞','🥖','🥐','🍕','🍔','🌮','🌯',
  '🍲','🥘','🥣','🍛',
  '🥗','🥚','🍳','🧀','🍪','🍰','🧁','🥠',
  '🥛','🍵','☕',
  '🍎','🍊','🍋','🍇','🍓','🍑','🍉',
]

// 餐次配置
export const MEALS = [
  { key: 'breakfast', icon: '🌅', label: '早餐' },
  { key: 'lunch', icon: '🌞', label: '午餐' },
  { key: 'dinner', icon: '🌙', label: '晚餐' },
] as const
