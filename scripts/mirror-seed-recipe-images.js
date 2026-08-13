const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const ENV_ID = 'cloud1-d4g2275j3b7f31ddd'
// CloudBase file IDs include the storage bucket identifier after the environment ID.
// Keep this in sync with the file ID returned by wx.cloud.uploadFile in the app.
const FILE_ID_PREFIX = 'cloud://cloud1-d4g2275j3b7f31ddd.636c-cloud1-d4g2275j3b7f31ddd-1467129221'
const LEGACY_FILE_ID_PREFIX = `cloud://${ENV_ID}.${ENV_ID}`
const RECIPES_FILE = path.join(PROJECT_ROOT, 'miniprogram/cloudfunctions/seedData/seedRecipes.js')
const IMAGE_DIR = path.join(PROJECT_ROOT, '.tmp/seed-recipe-images')
const CLOUD_DIR = 'dishes/seed-recipes'
const MANIFEST_FILE = path.join(PROJECT_ROOT, '.tmp/seed-recipe-image-manifest.json')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function loadRecipes() {
  delete require.cache[require.resolve(RECIPES_FILE)]
  return require(RECIPES_FILE)
}

function hashUrl(url) {
  let hash = 2166136261
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function getExtension(url) {
  const pathname = new URL(url).pathname
  const ext = path.extname(pathname).toLowerCase()
  return ext && ext.length <= 6 ? ext : '.jpg'
}

async function downloadImage(url, localPath) {
  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) return

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${url}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(localPath, buffer)
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return {}
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  return Object.fromEntries(
    Object.entries(manifest).map(([url, fileId]) => [url, normalizeFileId(fileId)])
  )
}

function writeManifest(manifest) {
  ensureDir(path.dirname(MANIFEST_FILE))
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2))
}

function normalizeFileId(fileId) {
  if (typeof fileId !== 'string') return fileId
  if (fileId.startsWith(LEGACY_FILE_ID_PREFIX + '/')) {
    return FILE_ID_PREFIX + fileId.slice(LEGACY_FILE_ID_PREFIX.length)
  }
  return fileId
}

function makeFileId(cloudPath) {
  return `${FILE_ID_PREFIX}/${cloudPath}`
}

function uploadImage(localPath, cloudPath) {
  const output = execFileSync('tcb', [
    '-e',
    ENV_ID,
    'storage',
    'upload',
    localPath,
    cloudPath,
    '--json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })

  try {
    const parsed = JSON.parse(output)
    const fileId =
      parsed.fileID ||
      parsed.fileId ||
      parsed.FileId ||
      parsed.file_id ||
      parsed?.data?.fileID ||
      parsed?.data?.fileId ||
      parsed?.data?.FileId ||
      parsed?.data?.file_id
    if (fileId) return fileId
    return makeFileId(cloudPath)
  } catch (err) {
    const match = output.match(/cloud:\/\/[^\s"']+/)
    if (match) return match[0]
  }

  return makeFileId(cloudPath)
}

function writeRecipes(recipes) {
  const content = `// Generated from /Users/xiaoxing/Downloads/食谱.\n// Images mirrored to CloudBase storage by scripts/mirror-seed-recipe-images.js.\n\nconst SEED_RECIPES = ${JSON.stringify(recipes, null, 2)}\n\nmodule.exports = SEED_RECIPES\n`
  fs.writeFileSync(RECIPES_FILE, content)
}

function getNumberArg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 必须跟一个大于 0 的整数`)
  }
  return value
}

async function main() {
  ensureDir(IMAGE_DIR)

  const recipes = loadRecipes()
  const forceUpload = process.argv.includes('--force-upload')
  const limit = getNumberArg('--limit')
  const manifest = readManifest()
  const previousManifest = { ...manifest }
  const urlToLocal = new Map()
  for (const recipe of recipes) {
    if (!recipe.image || recipe.image.startsWith('cloud://')) continue
    const ext = getExtension(recipe.image)
    const fileName = `${hashUrl(recipe.image)}${ext}`
    urlToLocal.set(recipe.image, {
      localPath: path.join(IMAGE_DIR, fileName),
      cloudPath: `${CLOUD_DIR}/${fileName}`,
    })
  }

  if (forceUpload) {
    for (const url of Object.keys(manifest)) {
      const ext = getExtension(url)
      const fileName = `${hashUrl(url)}${ext}`
      const localPath = path.join(IMAGE_DIR, fileName)
      if (!fs.existsSync(localPath)) continue
      urlToLocal.set(url, {
        localPath,
        cloudPath: `${CLOUD_DIR}/${fileName}`,
      })
    }
  }

  if (limit && urlToLocal.size > limit) {
    for (const url of Array.from(urlToLocal.keys()).slice(limit)) {
      urlToLocal.delete(url)
    }
  }

  console.log(`images to mirror: ${urlToLocal.size}`)
  let index = 0
  for (const [url, info] of urlToLocal) {
    index++
    console.log(`[${index}/${urlToLocal.size}] download ${url}`)
    await downloadImage(url, info.localPath)
  }

  index = 0
  const urlToFileId = new Map(Object.entries(manifest))
  for (const [url, info] of urlToLocal) {
    if (!forceUpload && urlToFileId.has(url)) continue
    index++
    console.log(`[${index}/${urlToLocal.size}] upload ${info.cloudPath}`)
    const fileId = uploadImage(info.localPath, info.cloudPath)
    urlToFileId.set(url, fileId)
    manifest[url] = fileId
    writeManifest(manifest)
  }

  const oldFileIds = forceUpload ? new Map(
    Object.entries(previousManifest).map(([url, fileId]) => [fileId, url])
  ) : new Map()
  const nextRecipes = recipes.map((recipe) => ({
    ...recipe,
    image:
      urlToFileId.get(recipe.image) ||
      urlToFileId.get(oldFileIds.get(recipe.image)) ||
      recipe.image,
  }))
  writeRecipes(nextRecipes)
  console.log(`updated ${RECIPES_FILE}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
