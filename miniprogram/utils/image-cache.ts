const IMAGE_CACHE_KEY = 'dishImageCache'

type ImageCache = Record<string, string>
type DishImageCacheItem = { source: string; path: string }

// 页面之间复用同一份解析结果，避免同一次打开小程序时重复访问文件系统。
const memoryCache: ImageCache = {}
const pendingDownloads: Record<string, Promise<string>> = {}
const dishImageMemoryCache: Record<string, DishImageCacheItem> = {}

function readImageCache(): ImageCache {
  const cache = wx.getStorageSync(IMAGE_CACHE_KEY)
  return cache && typeof cache === 'object' ? cache as ImageCache : {}
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
  if (filePath.startsWith('wxfile://usr/')) return Promise.resolve(filePath)

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
      const downloaded = await wx.cloud.downloadFile({ fileID: image })
      const saved = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().saveFile({
          tempFilePath: downloaded.tempFilePath,
          success: (res) => resolve(res.savedFilePath),
          fail: reject,
        })
      })

      cache[image] = saved
      memoryCache[image] = saved
      wx.setStorageSync(IMAGE_CACHE_KEY, cache)
      return saved
    } catch (err) {
      console.warn('图片本地缓存失败，继续使用云图片:', err)
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
  return Promise.all(items.map(async (item) => {
    const displayImage = await resolveDishImage(item.image)
    const id = (item as T & { _id?: string })._id
    if (id && displayImage) {
      dishImageMemoryCache[id] = { source: item.image, path: displayImage }
    }
    return { ...item, displayImage }
  }))
}

/** 获取本次打开小程序期间已经解析好的菜品图片路径。 */
export function getCachedDishImage(id: string, source: string): string {
  const cached = dishImageMemoryCache[id]
  return cached?.source === source ? cached.path : ''
}
