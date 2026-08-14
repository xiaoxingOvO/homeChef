// 新菜装配：把抓到的详情（steps/ingredients/image）转成 seed 格式追加到 recipes-new.json
// 用法: node build-new.js 'JSON'     详见下方 addDetail
// 文件:
//   scripts/scrape/selected.json   - 入选菜（含 id/name/cat）
//   scripts/scrape/recipes-new.json - 输出：seed 格式新菜（image 先留远程 URL）
const fs = require('fs')
const path = require('path')

const DIR = __dirname
const SELECTED_FILE = path.join(DIR, 'selected.json')
const RECIPES_FILE = path.join(DIR, 'recipes-new.json')
const CANDIDATES_FILE = path.join(DIR, 'candidates.json')

const DEFAULT_CATEGORIES = ['荤菜', '素菜', '汤', '主食', '凉菜', '小吃', '其他']

const MEAT_WORDS = [
  '肉', '猪', '牛', '鸡', '鸭', '鹅', '羊', '鱼', '虾', '蟹', '排骨', '骨',
  '翅', '腿', '爪', '肠', '肚', '肝', '心', '腰', '皮', '肘', '蹄', '头',
  '鲍', '贝', '蛤', '蚝', '鱿', '鳝', '鳗', '蛙', '蛋', '腊',
]

const EMOJI_BY_CAT = {
  荤菜: '🍖',
  素菜: '🥬',
  汤: '🍲',
  主食: '🍚',
  凉菜: '🥗',
  小吃: '🍡',
  其他: '🍽️',
}

// seed 分类 -> 默认 emoji（大体一致，可被覆盖）
const CAT_ALIAS = {
  tanggeng: '汤',
  liangcai: '凉菜',
  zhushi: '主食',
  xiaochi: '小吃',
  jiangpaoyancai: '其他',
}

function isMeat(name) {
  return MEAT_WORDS.some((w) => name.includes(w))
}

function normalizeCat(id, name) {
  const meta = selected.find((s) => s.id === id)
  const cat = meta ? meta.cat : ''
  if (cat === 'recai') {
    return isMeat(name) ? '荤菜' : '素菜'
  }
  return CAT_ALIAS[cat] || '其他'
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const selected = loadJson(SELECTED_FILE, [])

// 校验并追加一条新菜
// input: { id, name?, image?, steps[], note?, emoji?, stars? }
function addDetail(item) {
  if (!item || !item.id) throw new Error('缺少 id')
  const meta = selected.find((s) => s.id === item.id)
  if (!meta) throw new Error(`[${item.id}] 不在 selected.json 中，跳过`)
  if (!Array.isArray(item.steps) || item.steps.length === 0) {
    throw new Error(`[${item.id}] steps 为空`)
  }
  for (const s of item.steps) {
    if (!s || !s.trim()) throw new Error(`[${item.id}] 存在空步骤`)
    if (/!\[/.test(s)) throw new Error(`[${item.id}] 步骤内含图片标记`)
  }
  const name = item.name || meta.name || ''
  if (!name) throw new Error(`[${item.id}] 缺 name`)
  const category = item.category || normalizeCat(item.id, name)
  if (!DEFAULT_CATEGORIES.includes(category)) {
    throw new Error(`[${item.id}] 非法分类: ${category}`)
  }
  if (!item.image) throw new Error(`[${item.id}] 缺 image`)
  const recipes = loadJson(RECIPES_FILE, [])
  if (recipes.some((r) => r.id === item.id)) {
    throw new Error(`[${item.id}] 已存在`)
  }
  recipes.push({
    id: item.id,
    name,
    category,
    emoji: item.emoji || EMOJI_BY_CAT[category],
    stars: item.stars != null ? item.stars : 1,
    count: 0,
    image: item.image,
    steps: item.steps.map((s) => s.trim()),
    note: item.note || '',
  })
  saveJson(RECIPES_FILE, recipes)
  return `[${item.id}] ${name} -> ${category} (${recipes.length})`
}

// 批量追加
function addMany(list) {
  for (const item of list) {
    try {
      console.log(addDetail(item))
    } catch (e) {
      console.log('跳过:', e.message)
    }
  }
  const recipes = loadJson(RECIPES_FILE, [])
  console.log(`食谱总数: ${recipes.length}`)
}

// 按分类统计
function stats() {
  const recipes = loadJson(RECIPES_FILE, [])
  const byCat = {}
  for (const r of recipes) byCat[r.category] = (byCat[r.category] || 0) + 1
  console.log('recipes-new.json:', recipes.length, JSON.stringify(byCat))
}

// 合并一个 part 文件（agent 输出）到 recipes-new.json
function merge(file) {
  const list = loadJson(file, [])
  if (!Array.isArray(list)) throw new Error(`${file} 不是数组`)
  console.log(`合并 ${file}: ${list.length} 条`)
  addMany(list)
}

const cmd = process.argv[2]
if (cmd === 'add') {
  addMany(JSON.parse(process.argv[3]))
} else if (cmd === 'merge') {
  merge(process.argv[3])
} else if (cmd === 'stats') {
  stats()
} else {
  console.log('用法: node build-new.js add \'[...]\' | merge <part.json> | stats')
  console.log('add 每项: {id, steps[], image, name?, note?, emoji?, stars?, category?}')
}