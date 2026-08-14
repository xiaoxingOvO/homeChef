// 分析 seedRecipes.js 中同名/近名菜品的变体聚类
// 用法: node scripts/analyze-seed-variants.js
const fs = require('fs')
const path = require('path')

const seedPath = path.join(__dirname, '../homeChef/cloudfunctions/seedData/seedRecipes.js')
const src = fs.readFileSync(seedPath, 'utf8')
const match = src.match(/const\s+SEED_RECIPES\s*=\s*(\[[\s\S]*\])\s*\nmodule\.exports/)
if (!match) {
  console.error('无法解析 seedRecipes.js')
  process.exit(1)
}
const recipes = eval(match[1])

function normalizeName(name) {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[|｜:：]/g, ' ')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/❗️|❗|日食记|菜谱/g, '')
    .replace(/\s+/g, '')
    .trim()
}

// 提取核心菜名: 去掉口感/做法前后缀词
const SUFFIX_WORDS = [
  '食谱', '家常做法', '的做法', '的做法大全', '盖浇饭', '盖饭', '拌饭', '炒饭', '焖饭', '烩饭', '焗饭',
  '干锅', '小炒', '版', '家庭版', '快手版', '简易版', '升级版', '经典',
]
function coreName(name) {
  let n = normalizeName(name)
  for (const w of SUFFIX_WORDS) {
    if (n.endsWith(w) && n.length > w.length + 2) {
      n = n.slice(0, -w.length)
    }
  }
  return n
}

const groups = new Map()
for (const r of recipes) {
  const c = coreName(r.name)
  if (!groups.has(c)) groups.set(c, [])
  groups.get(c).push(r)
}

// 知名菜核心名（美食天下最受欢迎家常菜 + 常见后缀变体）
const POPULAR_DISHES = [
  '红烧肉', '红烧排骨', '红烧鱼', '红烧茄子', '红烧鸡翅', '红烧鸡块', '红烧豆腐',
  '鱼香肉丝', '可乐鸡翅', '宫保鸡丁', '糖醋排骨', '糖醋里脊', '糖醋鱼',
  '水煮肉片', '水煮鱼', '麻婆豆腐', '辣子鸡', '酸菜鱼', '回锅肉',
  '鱼香茄子', '番茄炒蛋', '西红柿炒鸡蛋', '京酱肉丝', '黄焖鸡', '啤酒鸭',
  '干煸豆角', '地三鲜', '油焖大虾', '白灼虾', '清蒸鲈鱼', '清蒸鱼',
  '蒜蓉西兰花', '酸辣土豆丝', '醋溜白菜', '小炒肉', '青椒炒肉',
]
// 包含知名菜名的名字归到该菜名下
const byContain = new Map()
for (const r of recipes) {
  const n = normalizeName(r.name)
  let matched = POPULAR_DISHES.find((p) => n.includes(p) && n.length > p.length + 2)
  if (matched) {
    const key = '变体:' + matched
    if (!byContain.has(key)) byContain.set(key, [])
    byContain.get(key).push(r)
  }
}

const variants = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)
const containVariants = [...byContain.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)

console.log('总菜品数:', recipes.length)
console.log('去核心名后唯一菜数:', groups.size)
console.log('同名变体可清理数(每核心保留1个):', recipes.length - groups.size)
console.log('含知名菜名变体组数:', containVariants.length)
console.log('含知名菜名变体可清理数(每组保留1个):', containVariants.reduce((s, g) => s + g.length - 1, 0))
console.log('')
console.log('=== 变体最多的 60 个核心菜 ===')
for (const g of variants.slice(0, 60)) {
  console.log(`\n【${g[0].name.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[|｜:：].*$/, '')}】×${g.length}`)
  for (const r of g) {
    console.log(`  ${r.name}  [${r.category}] ★${r.stars} x${r.count}`)
  }
}
console.log('')
console.log('=== 知名菜名包含变体 ===')
for (const g of containVariants) {
  console.log(`\n【${g[0].name.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')} 等】×${g.length}`)
  for (const r of g) {
    console.log(`  ${r.name}  [${r.category}] ★${r.stars}`)
  }
}