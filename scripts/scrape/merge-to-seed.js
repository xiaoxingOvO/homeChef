const fs = require('fs')
const path = require('path')

const SEED_PATH = path.join(__dirname, '../../homeChef/cloudfunctions/seedData/seedRecipes.js')
const NEW_PATH = path.join(__dirname, 'recipes-new.json')

const oldRecipes = require(SEED_PATH)
const newRecipes = JSON.parse(fs.readFileSync(NEW_PATH, 'utf8'))

const oldNames = new Set(oldRecipes.map((r) => r.name))
let replaced = 0
let appended = 0

for (const r of newRecipes) {
  if (oldNames.has(r.name)) {
    const idx = oldRecipes.findIndex((o) => o.name === r.name)
    oldRecipes[idx] = r
    replaced++
  } else {
    oldRecipes.push(r)
    appended++
  }
}

const header = `// Generated from /Users/xiaoxing/Downloads/食谱.
// Images mirrored to CloudBase storage by scripts/mirror-seed-recipe-images.js.

const SEED_RECIPES = `

const content =
  header +
  JSON.stringify(oldRecipes, null, 2)
    .replace(/^\[/, '[\n  ')
    .replace(/\n}/g, '\n  }')
    .replace(/^  },/gm, '  },')
    .replace(/\n\]$/, '\n]\n') +
  '\nmodule.exports = SEED_RECIPES\n'

fs.writeFileSync(SEED_PATH, content)

console.log(`合并完成：新增 ${appended} 条，替换重名 ${replaced} 条，seed 总数 ${oldRecipes.length}`)
