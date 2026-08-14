const IMAGE_CACHE_KEY = 'dishImageCache'

type ImageCache = Record<string, string>
type DishImageCacheItem = { source: string; path: string }

// 页面之间复用同一份解析结果，避免同一次打开小程序时重复访问文件系统。
const memoryCache: ImageCache = {}
const pendingDownloads: Record<string, Promise<string> | undefined> = {}
const dishImageMemoryCache: Record<string, DishImageCacheItem> = {}

// 只有本地持久文件才能安全写入 Storage；临时链接有过期时间，只能放内存。
const PERSISTABLE_PATH_PREFIX = 'wxfile://usr/'

function readImageCache(): ImageCache {
  const cache = wx.getStorageSync(IMAGE_CACHE_KEY)
  if (!cache || typeof cache !== 'object') return {}

  // 清理历史版本写入的过期临时链接，避免冷启动后直接命中失效 URL。
  const cleaned: ImageCache = {}
  let dirty = false
  Object.keys(cache as ImageCache).forEach((key) => {
    const value = (cache as ImageCache)[key]
    if (typeof value === 'string' && value.startsWith(PERSISTABLE_PATH_PREFIX)) {
      cleaned[key] = value
    } else {
      dirty = true
    }
  })
  if (dirty) wx.setStorageSync(IMAGE_CACHE_KEY, cleaned)
  return cleaned
}

function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().access({
      path,
      success: () => resolve(true),
      fail: () => resolve(false),
    })
  })
}

function saveLocalImage(filePath: string): Promise<string> {
  if (filePath.startsWith(PERSISTABLE_PATH_PREFIX)) return Promise.resolve(filePath)

  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath: filePath,
      success: (res) => resolve(res.savedFilePath),
      fail: reject,
    })
  })
}

/** 将刚上传成功的本地图片登记到缓存，后续展示无需再从云端下载。 */
export async function rememberDishImage(image: string, filePath: string): Promise<string> {
  if (!image || !filePath) return filePath

  let savedPath = filePath
  try {
    savedPath = await saveLocalImage(filePath)
  } catch (err) {
    console.warn('保存上传图片缓存失败，暂时使用临时文件:', err)
  }

  const cache = readImageCache()
  cache[image] = savedPath
  memoryCache[image] = savedPath
  wx.setStorageSync(IMAGE_CACHE_KEY, cache)
  return savedPath
}

/** 将云存储图片缓存到本地，普通 URL 直接交给微信图片组件处理。 */
export async function resolveDishImage(image: string): Promise<string> {
  if (!image || !image.startsWith('cloud://')) return image

  if (memoryCache[image]) return memoryCache[image]
  if (pendingDownloads[image]) return pendingDownloads[image]

  pendingDownloads[image] = (async () => {
    const cache = readImageCache()
    const cachedPath = cache[image]
    if (cachedPath && await fileExists(cachedPath)) {
      memoryCache[image] = cachedPath
      return cachedPath
    }

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [image] })
      const tempURL = res.fileList?.[0]?.tempFileURL
      const resolved = tempURL || image
      // 临时链接会过期，不写入 Storage，避免下次启动命中失效 URL。
      memoryCache[image] = resolved
      return resolved
    } catch (err) {
      console.warn('图片临时链接解析失败，继续使用云图片:', err)
      return image
    } finally {
      delete pendingDownloads[image]
    }
  })()

  return pendingDownloads[image]
}

export async function resolveDishImages<T extends { image: string }>(
  items: T[]
): Promise<Array<T & { displayImage: string }>> {
  const result = items.map((item) => ({ ...item, displayImage: item.image || '' }))
  const cloudImages = [...new Set(items
    .map((item) => item.image)
    .filter((image) => image && image.startsWith('cloud://') && !memoryCache[image])
  )]

  for (let i = 0; i < cloudImages.length; i += 50) {
    const fileList = cloudImages.slice(i, i + 50)
    try {
      const res = await wx.cloud.getTempFileURL({ fileList })
      res.fileList?.forEach((file) => {
        if (file.fileID && file.tempFileURL) {
          memoryCache[file.fileID] = file.tempFileURL
        }
      })
    } catch (err) {
      console.warn('批量解析图片临时链接失败，继续使用原始图片地址:', err)
    }
  }

  return result.map((item) => {
    const displayImage = memoryCache[item.image] || item.displayImage
    const id = (item as T & { _id?: string })._id
    if (id && displayImage) {
      dishImageMemoryCache[id] = { source: item.image, path: displayImage }
    }
    return { ...item, displayImage }
  })
}

/** 只用当前已知缓存同步生成显示图片，不触发云端解析。适合页面首帧快速渲染。 */
export function resolveDishImagesFromCache<T extends { image: string; _id?: string }>(
  items: T[]
): Array<T & { displayImage: string }> {
  const storageCache = readImageCache()
  return items.map((item) => {
    const byId = item._id ? dishImageMemoryCache[item._id] : undefined
    const displayImage =
      (byId?.source === item.image ? byId.path : '') ||
      memoryCache[item.image] ||
      storageCache[item.image] ||
      item.image ||
      ''

    if (item._id && displayImage) {
      dishImageMemoryCache[item._id] = { source: item.image, path: displayImage }
    }

    return { ...item, displayImage }
  })
}

/** 获取本次打开小程序期间已经解析好的菜品图片路径。 */
export function getCachedDishImage(id: string, source: string): string {
  const cached = dishImageMemoryCache[id]
  return cached?.source === source ? cached.path : ''
}
