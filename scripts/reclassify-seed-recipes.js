const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const RECIPES_FILE = path.join(
  PROJECT_ROOT,
  'homeChef/cloudfunctions/seedData/seedRecipes.js'
)

function has(text, words) {
  return words.some((word) => text.includes(word))
}

function classify(name) {
  const text = String(name || '')

  // 调味料、馅料和饮品没有明确的菜肴类别，放到“其他”。
  if (has(text, [
    '红豆沙馅', '豆沙馅', '红豆馅', '蜜红豆', '红豆沙',
    '番茄酱', '沙拉汁', '豆浆', '柠檬水', '薏米水',
    '柠檬茶', '薏米茶',
  ])) return '其他'

  // 甜品、点心归入“小吃”；“汤圆”也不是汤类菜肴。
  if (has(text, [
    '布丁', '椰汁糕', '芝士条', '松饼', '月饼',
    '甜品', '汤圆',
  ])) return '小吃'

  // 只有明确的面、饭团、面包、披萨、饼等才算主食。
  if (has(text, [
    '饭团', '寿司', '披萨', '吐司', '方便面', '拌面',
    '鸡蛋面', '排骨面', '沙拉面包', '蛋饼', '芝士饼', '年糕',
  ])) return '主食'
  if (text.includes('面包') && !text.includes('面包糠')) return '主食'

  if (has(text, [
    '凉拌', '拍黄瓜', '刀拍黄瓜', '大拌菜', '炝拌',
    '辣拌', '泡菜', '咸菜', '沙拉',
  ]) && !has(text, ['沙拉酱', '沙拉饭团', '沙拉面包'])) {
    return '凉菜'
  }

  // 排除“汤汁/汤鲜/汤泡饭”等描述性用词，避免把普通炒菜误判为汤。
  if (has(text, [
    '汤', '粥', '羹', '糖水',
  ]) && !has(text, [
    '汤汁', '汤鲜', '汤泡饭', '配米饭真香', '糖醋汁',
    '茄汁', '鸡汁', '沙拉汁', '爆汁',
  ])) {
    return '汤'
  }

  if (has(text, [
    '红烧肉', '叉烧肉', '东坡肉', '回锅肉', '肉丝', '肉片',
    '肉沫', '肉末', '肉丸', '猪肝', '猪肉', '牛肉', '牛腩', '肥牛', '排骨',
    '里脊', '鸡翅', '鸡丁', '鸡胸', '黄焖鸡', '鸡腿', '烤鸡',
    '鸡蛋', '炒蛋', '卤蛋', '鹌鹑蛋', '鲈鱼', '酸菜鱼',
    '番茄鱼', '海鱼', '三文鱼', '青花鱼', '虾', '大虾',
    '虾仁', '龙虾', '鲍鱼', '海鲜', '火腿', '香肠',
    '皮蛋', '木须肉', '毛血旺', '京酱肉丝',
    '糖醋排骨', '糖醋里脊', '宫保鸡丁', '可乐鸡翅', '油焖大虾',
  ])) return '荤菜'

  if (has(text, [
    '豆腐', '茄子', '地三鲜', '土豆', '冬瓜', '白菜',
    '生菜', '藕', '秋葵', '西兰花', '黄瓜', '菜花',
    '西葫芦', '芹菜', '腐竹', '香干', '豆干', '粉条',
    '番茄', '西红柿', '红豆山药泥',
  ])) return '素菜'

  if (has(text, ['麻辣香锅', '三汁焖锅'])) return '其他'
  return '其他'
}

delete require.cache[require.resolve(RECIPES_FILE)]
const recipes = require(RECIPES_FILE)
const nextRecipes = recipes.map((recipe) => ({
  ...recipe,
  category: classify(recipe.name),
}))

const distribution = nextRecipes.reduce((result, recipe) => {
  result[recipe.category] = (result[recipe.category] || 0) + 1
  return result
}, {})

const content = `// Generated from /Users/xiaoxing/Downloads/食谱.
// Images mirrored to CloudBase storage by scripts/mirror-seed-recipe-images.js.

const SEED_RECIPES = ${JSON.stringify(nextRecipes, null, 2)}

module.exports = SEED_RECIPES
`

fs.writeFileSync(RECIPES_FILE, content)
console.log(`reclassified ${nextRecipes.length} recipes`)
console.log(distribution)
