// 抓取管线：候选菜管理
// 文件:
//   scripts/scrape/candidates.json  - 候选菜列表（列表页抓取所得）
//   scripts/scrape/selected.json    - 最终入选待抓详情的菜
//   scripts/scrape/recipes-new.json - 已抓完详情、组装好的新菜
const fs = require('fs')
const path = require('path')

const DIR = __dirname
const CANDIDATES_FILE = path.join(DIR, 'candidates.json')
const SELECTED_FILE = path.join(DIR, 'selected.json')
const RECIPES_FILE = path.join(DIR, 'recipes-new.json')
const SEED_PATH = path.join(DIR, '../../homeChef/cloudfunctions/seedData/seedRecipes.js')

const SUFFIX_WORDS = [
  '食谱', '家常做法', '的做法', '的做法大全', '盖浇饭', '盖饭', '拌饭', '炒饭', '焖饭', '烩饭', '焗饭',
  '干锅', '小炒', '版', '家庭版', '快手版', '简易版', '升级版', '经典',
]
const HYPE_PREFIXES = ['日食记', '美食天下', '零失败', '一学就会', '新手', '懒人', '快手', '私房']

function normalizeName(name) {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[|｜:：]/g, ' ')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/❗️|❗|！|～|~|❗|📌/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function coreName(name) {
  let n = normalizeName(name)
  for (const w of SUFFIX_WORDS) {
    if (n.endsWith(w) && n.length > w.length + 2) n = n.slice(0, -w.length)
  }
  return n
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// 现有 seed 库的核心名集合（用于排除已有菜）
function loadExistingNames() {
  const src = fs.readFileSync(SEED_PATH, 'utf8')
  const match = src.match(/const\s+SEED_RECIPES\s*=\s*(\[[\s\S]*\])\s*\nmodule\.exports/)
  const recipes = match ? eval(match[1]) : []
  const names = new Set()
  for (const r of recipes) {
    const c = coreName(r.name)
    if (c.length >= 2) names.add(c)
    const n = normalizeName(r.name)
    if (n.length >= 2) names.add(n)
  }
  return names
}

// 批量添加候选（去重：同 id 或同核心名）
function addCandidates(list, source) {
  const candidates = loadJson(CANDIDATES_FILE, [])
  const existingIds = new Set(candidates.map((c) => c.id))
  const existingCores = new Set(candidates.map((c) => c.core))
  let added = 0
  for (const item of list) {
    if (!item.id || !item.name) continue
    const core = coreName(item.name)
    if (existingIds.has(item.id)) continue
    if (core.length >= 3 && existingCores.has(core)) continue
    existingIds.add(item.id)
    existingCores.add(core)
    candidates.push({
      id: item.id,
      name: item.name,
      core,
      cat: item.cat || '',
      fav: item.fav || 0,
      ingredients: item.ingredients || '',
      source: source || '',
    })
    added++
  }
  saveJson(CANDIDATES_FILE, candidates)
  console.log(`新增 ${added} 条候选（去重后），当前候选池共 ${candidates.length} 条`)
}

// 选择：排除与现有库核心名重复的
function select() {
  const candidates = loadJson(CANDIDATES_FILE, [])
  const existing = loadExistingNames()
  const selected = []
  const seenCores = new Set()
  for (const c of candidates) {
    if (c.core && c.core.length >= 3 && existing.has(c.core)) continue
    if (seenCores.has(c.core)) continue
    seenCores.add(c.core)
    selected.push(c)
  }
  saveJson(SELECTED_FILE, selected)
  console.log(`候选 ${candidates.length} → 选中 ${selected.length}（已排除 ${candidates.length - selected.length} 条与现有库重复）`)
  return selected
}

const cmd = process.argv[2]
if (cmd === 'add') {
  addCandidates(JSON.parse(process.argv[3]), process.argv[4])
} else if (cmd === 'select') {
  select()
} else if (cmd === 'stats') {
  const candidates = loadJson(CANDIDATES_FILE, [])
  const byCat = {}
  for (const c of candidates) byCat[c.cat] = (byCat[c.cat] || 0) + 1
  console.log('候选池:', candidates.length, byCat)
} else {
  console.log('用法: node manage.js add \'[...]\' <source> | select | stats')
}
