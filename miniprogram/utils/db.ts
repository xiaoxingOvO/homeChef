/**
 * CloudBase 数据库操作
 */

const db = wx.cloud.database()
const _ = db.command

type DishQueryOptions = {
  skip?: number
  limit?: number
  category?: string
  search?: string
}

export const DB_QUERY_LIMIT = 20

const dishPageCache = new Map<string, Dish[]>()
const dishCountCache = new Map<string, number>()
const pendingDishPages = new Map<string, Promise<Dish[]>>()
const pendingDishCounts = new Map<string, Promise<number>>()
const mealPlansByDateCache = new Map<string, MealPlan>()
const mealPlanDateMissCache = new Set<string>()
const mealMonthCache = new Map<string, MealPlan[]>()
const pendingMealPlans = new Map<string, Promise<MealPlan[]>>()
const pendingMealMonths = new Map<string, Promise<MealPlan[]>>()
let categoriesCache: Category[] | null = null
let pendingCategories: Promise<Category[]> | null = null
let userSettingsCache: UserSettings | null | undefined = undefined

function dishPageCacheKey(options: DishQueryOptions = {}): string {
  return JSON.stringify({
    skip: Math.max(0, options.skip || 0),
    limit: Math.max(1, Math.min(options.limit || DB_QUERY_LIMIT, DB_QUERY_LIMIT)),
    category: options.category || '全部',
    search: options.search?.trim() || '',
  })
}

function dishCountCacheKey(options: DishQueryOptions = {}): string {
  return JSON.stringify({
    category: options.category || '全部',
    search: options.search?.trim() || '',
  })
}

function invalidateDishCache() {
  dishPageCache.clear()
  dishCountCache.clear()
  pendingDishPages.clear()
  pendingDishCounts.clear()
}

function mealMonthCacheKey(year: number, month: number): string {
  return year + '-' + String(month + 1).padStart(2, '0')
}

function rememberMealPlans(plans: MealPlan[]) {
  plans.forEach((plan) => {
    mealPlansByDateCache.set(plan.date, plan)
    mealPlanDateMissCache.delete(plan.date)
  })
}

function rememberMealPlanMisses(dates: string[], plans: MealPlan[]) {
  const hitDates = new Set(plans.map((plan) => plan.date))
  dates.forEach((date) => {
    if (!hitDates.has(date)) mealPlanDateMissCache.add(date)
  })
}

function invalidateMealPlanMonth(date: string) {
  const parsed = new Date(date)
  if (!Number.isNaN(parsed.getTime())) {
    mealMonthCache.delete(mealMonthCacheKey(parsed.getFullYear(), parsed.getMonth()))
  } else {
    mealMonthCache.clear()
  }
}

function upsertMealPlanCache(plan: MealPlan) {
  mealPlansByDateCache.set(plan.date, plan)
  mealPlanDateMissCache.delete(plan.date)
  invalidateMealPlanMonth(plan.date)
}

function removeMealPlanCache(date: string) {
  mealPlansByDateCache.delete(date)
  mealPlanDateMissCache.add(date)
  invalidateMealPlanMonth(date)
}

/** 等待 App 完成首次用户数据初始化，避免首屏查询早于示例数据写入。 */
async function waitForAppReady(): Promise<void> {
  const app = getApp<IAppOption>()
  if (app?.globalData?.readyPromise) {
    await app.globalData.readyPromise
  }
}

// ==================== 菜品 ====================

function buildDishQuery(options: DishQueryOptions = {}) {
  const where: Record<string, any> = {}
  if (options.category && options.category !== '全部') {
    where.category = options.category
  }
  const search = options.search?.trim()
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    where.name = (db as any).RegExp({
      regexp: escaped,
      options: 'i',
    })
  }
  return where
}

/** 分页获取菜品。列表页使用它，避免首屏一次拉取全部菜品。 */
export async function getDishesPage(options: DishQueryOptions = {}): Promise<Dish[]> {
  await waitForAppReady()
  // 小程序端云数据库单次 get 通常最多返回 20 条。统一按 20 分页，
  // 避免调用方传 30/40/50 后拿到 20 条，却误判“没有更多”。
  const limit = Math.max(1, Math.min(options.limit || DB_QUERY_LIMIT, DB_QUERY_LIMIT))
  const skip = Math.max(0, options.skip || 0)
  const where = buildDishQuery(options)
  const cacheKey = dishPageCacheKey({ ...options, skip, limit })
  if (dishPageCache.has(cacheKey)) return dishPageCache.get(cacheKey) as Dish[]
  if (pendingDishPages.has(cacheKey)) return pendingDishPages.get(cacheKey) as Promise<Dish[]>

  const request = db
    .collection('dishes')
    .where(where)
    .orderBy('createdAt', 'asc')
    .skip(skip)
    .limit(limit)
    .get()
    .then((res) => {
      const dishes = res.data as Dish[]
      dishPageCache.set(cacheKey, dishes)
      return dishes
    })
  request.then(() => {
    pendingDishPages.delete(cacheKey)
  }).catch(() => {
    pendingDishPages.delete(cacheKey)
  })

  pendingDishPages.set(cacheKey, request)
  return request
}

/** 同步读取已缓存的菜品分页。页面首帧可先用它渲染，后台再刷新云端数据。 */
export function getCachedDishesPage(options: DishQueryOptions = {}): Dish[] | null {
  const limit = Math.max(1, Math.min(options.limit || DB_QUERY_LIMIT, DB_QUERY_LIMIT))
  const skip = Math.max(0, options.skip || 0)
  const cacheKey = dishPageCacheKey({ ...options, skip, limit })
  return dishPageCache.get(cacheKey) || null
}

/** 统计菜品数量。统计页使用 count，避免为了数量读取完整列表。 */
export async function countDishes(options: DishQueryOptions = {}): Promise<number> {
  await waitForAppReady()
  const cacheKey = dishCountCacheKey(options)
  const cached = dishCountCache.get(cacheKey)
  if (typeof cached === 'number') return cached
  if (pendingDishCounts.has(cacheKey)) return pendingDishCounts.get(cacheKey) as Promise<number>

  const request = db.collection('dishes')
    .where(buildDishQuery(options))
    .count()
    .then((res) => {
      dishCountCache.set(cacheKey, res.total)
      return res.total
    })
  request.then(() => {
    pendingDishCounts.delete(cacheKey)
  }).catch(() => {
    pendingDishCounts.delete(cacheKey)
  })

  pendingDishCounts.set(cacheKey, request)
  return request
}

/** 同步读取已缓存的菜品数量。 */
export function getCachedDishCount(options: DishQueryOptions = {}): number | null {
  const cached = dishCountCache.get(dishCountCacheKey(options))
  return typeof cached === 'number' ? cached : null
}

/** 获取所有菜品 */
export async function getDishes(): Promise<Dish[]> {
  await waitForAppReady()
  const pageSize = DB_QUERY_LIMIT
  const dishes: Dish[] = []
  let page = 0

  while (true) {
    const batch = await getDishesPage({ skip: page * pageSize, limit: pageSize })
    dishes.push(...batch)
    if (batch.length < pageSize) break
    page++
  }

  return dishes
}

/** 获取一批随机菜品。随机填充用它，避免为了抽几十道菜读取完整 500 道列表。 */
export async function getRandomDishes(limit: number = 60): Promise<Dish[]> {
  await waitForAppReady()
  const total = await countDishes()
  if (total === 0) return []

  const pageSize = DB_QUERY_LIMIT
  const target = Math.max(1, Math.min(limit, total))
  const maxSkip = Math.max(0, total - pageSize)
  const seen = new Set<string>()
  const result: Dish[] = []
  const tries = Math.min(8, Math.max(3, Math.ceil(target / pageSize) + 2))

  for (let i = 0; i < tries && result.length < target; i++) {
    const skip = maxSkip === 0 ? 0 : Math.floor(Math.random() * (maxSkip + 1))
    const batch = await getDishesPage({ skip, limit: pageSize })
    batch.forEach((dish) => {
      const key = dish._id || dish.name
      if (!seen.has(key) && result.length < target) {
        seen.add(key)
        result.push(dish)
      }
    })
  }

  if (result.length < target) {
    const fallback = await getDishesPage({ skip: 0, limit: pageSize })
    fallback.forEach((dish) => {
      const key = dish._id || dish.name
      if (!seen.has(key) && result.length < target) {
        seen.add(key)
        result.push(dish)
      }
    })
  }

  return result
}

/** 按 id 获取单个菜品。详情页使用直接查询，避免全量分页不稳定导致找不到当前菜。 */
export async function getDishById(id: string): Promise<Dish | null> {
  await waitForAppReady()
  try {
    const res = await db.collection('dishes').doc(id).get()
    return res.data as Dish
  } catch (err) {
    console.error('获取菜品详情失败:', err)
    return null
  }
}

/** 按名称获取单个菜品。首页从菜单记录打开详情时使用，避免全量读取。 */
export async function getDishByName(name: string): Promise<Dish | null> {
  await waitForAppReady()
  const res = await db.collection('dishes').where({ name }).limit(1).get()
  return res.data[0] as Dish || null
}

/** 添加菜品 */
export async function addDish(dish: Omit<Dish, '_id' | '_openid'>): Promise<string> {
  await waitForAppReady()
  const now = new Date()
  const res = await db.collection('dishes').add({
    data: { ...dish, createdAt: now, updatedAt: now },
  })
  invalidateDishCache()
  return res._id
}

/** 更新菜品 */
export async function updateDish(id: string, data: Partial<Dish>): Promise<void> {
  await waitForAppReady()
  await db.collection('dishes').doc(id).update({ data })
  invalidateDishCache()
}

/** 删除菜品 */
export async function deleteDish(id: string): Promise<void> {
  await waitForAppReady()
  await db.collection('dishes').doc(id).remove()
  invalidateDishCache()
}

/** 批量删除菜品 */
export async function batchDeleteDishes(ids: string[]): Promise<void> {
  await waitForAppReady()
  // CloudBase 不支持直接批量删除，逐个删除
  const promises = ids.map(id => db.collection('dishes').doc(id).remove())
  await Promise.all(promises)
  invalidateDishCache()
}

/** 批量更新菜品分类 */
export async function batchUpdateCategory(ids: string[], category: string): Promise<void> {
  await waitForAppReady()
  const promises = ids.map(id =>
    db.collection('dishes').doc(id).update({ data: { category } })
  )
  await Promise.all(promises)
  invalidateDishCache()
}

// ==================== 分类 ====================

/** 获取所有分类 */
export async function getCategories(): Promise<Category[]> {
  await waitForAppReady()
  if (categoriesCache) return categoriesCache
  if (pendingCategories) return pendingCategories

  const request = db.collection('categories')
    .limit(100)
    .get()
    .then((res) => {
      const categories = (res.data as Category[])
        .map((category, index) => ({ category, index }))
        .sort((a, b) => {
          const aOrder = typeof a.category.order === 'number' ? a.category.order : a.index
          const bOrder = typeof b.category.order === 'number' ? b.category.order : b.index
          return aOrder - bOrder
        })
        .map(({ category }) => category)
      categoriesCache = categories
      return categories
    })
  request.then(() => {
    pendingCategories = null
  }).catch(() => {
    pendingCategories = null
  })

  pendingCategories = request
  return request
}

/** 同步读取已缓存的分类。 */
export function getCachedCategories(): Category[] | null {
  return categoriesCache
}

/** 添加分类 */
export async function addCategory(category: Omit<Category, '_id' | '_openid'>): Promise<string> {
  await waitForAppReady()
  const res = await db.collection('categories').add({ data: category })
  categoriesCache = null
  pendingCategories = null
  return res._id
}

/** 删除分类 */
export async function deleteCategory(id: string): Promise<void> {
  await waitForAppReady()
  await db.collection('categories').doc(id).remove()
  categoriesCache = null
  pendingCategories = null
}

/** 更新分类名称 */
export async function updateCategoryName(id: string, name: string): Promise<void> {
  await waitForAppReady()
  await db.collection('categories').doc(id).update({ data: { name } })
  categoriesCache = null
  pendingCategories = null
}

/** 保存分类顺序 */
export async function updateCategoryOrders(categories: Category[]): Promise<void> {
  await waitForAppReady()
  await Promise.all(
    categories.map((category, order) =>
      db.collection('categories').doc(category._id!).update({ data: { order } })
    )
  )
  categoriesCache = null
  pendingCategories = null
}

// ==================== 菜单规划 ====================

/** 获取某天的菜单规划 */
export async function getMealPlan(date: string): Promise<MealPlan | null> {
  await waitForAppReady()
  if (mealPlansByDateCache.has(date)) return mealPlansByDateCache.get(date) as MealPlan
  if (mealPlanDateMissCache.has(date)) return null

  const res = await db.collection('meal_plans').where({ date }).get()
  if (res.data.length > 0) {
    const plan = res.data[0] as MealPlan
    rememberMealPlans([plan])
    return plan
  }
  mealPlanDateMissCache.add(date)
  return null
}

/** 获取多天的菜单规划 */
export async function getMealPlans(dates: string[]): Promise<MealPlan[]> {
  await waitForAppReady()
  if (dates.length === 0) return []

  const normalizedDates = [...new Set(dates)]
  const missingDates = normalizedDates.filter((date) => {
    const cached = mealPlansByDateCache.get(date)
    if (cached) return false
    return !mealPlanDateMissCache.has(date)
  })

  if (missingDates.length === 0) {
    return normalizedDates
      .map((date) => mealPlansByDateCache.get(date))
      .filter((plan): plan is MealPlan => !!plan)
  }

  const batchSize = 20
  const batches: string[][] = []
  for (let i = 0; i < missingDates.length; i += batchSize) {
    batches.push(missingDates.slice(i, i + batchSize))
  }

  const results = await Promise.all(
    batches.map((batch) => {
      const key = batch.join('|')
      if (pendingMealPlans.has(key)) return pendingMealPlans.get(key) as Promise<MealPlan[]>

      const request = db.collection('meal_plans')
        .where({ date: _.in(batch) })
        .get()
        .then((result) => result.data as MealPlan[])
      request.then(() => {
        pendingMealPlans.delete(key)
      }).catch(() => {
        pendingMealPlans.delete(key)
      })
      pendingMealPlans.set(key, request)
      return request
    })
  )
  const fetchedPlans = results.flat()
  rememberMealPlans(fetchedPlans)
  rememberMealPlanMisses(missingDates, fetchedPlans)

  return normalizedDates
    .map((date) => mealPlansByDateCache.get(date))
    .filter((plan): plan is MealPlan => !!plan)
}

/** 同步读取已缓存的多天规划。返回 null 表示这批日期还没完整缓存。 */
export function getCachedMealPlans(dates: string[]): MealPlan[] | null {
  if (dates.length === 0) return []
  const normalizedDates = [...new Set(dates)]
  const complete = normalizedDates.every((date) =>
    mealPlansByDateCache.has(date) || mealPlanDateMissCache.has(date)
  )
  if (!complete) return null
  return normalizedDates
    .map((date) => mealPlansByDateCache.get(date))
    .filter((plan): plan is MealPlan => !!plan)
}

/** 获取当前用户的全部菜单规划，用于“总记录”等统计场景。 */
export async function getAllMealPlans(): Promise<MealPlan[]> {
  await waitForAppReady()
  const pageSize = 20
  const plans: MealPlan[] = []
  let page = 0

  while (true) {
    const res = await db
      .collection('meal_plans')
      .orderBy('date', 'asc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()
    const batch = res.data as MealPlan[]
    plans.push(...batch)
    if (batch.length < pageSize) break
    page++
  }

  rememberMealPlans(plans)
  return plans
}

/** 获取某月的菜单规划 */
export async function getMonthMealPlans(year: number, month: number): Promise<MealPlan[]> {
  await waitForAppReady()
  const cacheKey = mealMonthCacheKey(year, month)
  if (mealMonthCache.has(cacheKey)) return mealMonthCache.get(cacheKey) as MealPlan[]
  if (pendingMealMonths.has(cacheKey)) return pendingMealMonths.get(cacheKey) as Promise<MealPlan[]>

  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const endDate =
    month === 11
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 2).padStart(2, '0')}-01`
  const request = db
    .collection('meal_plans')
    .where({ date: _.gte(startDate).and(_.lt(endDate)) })
    .orderBy('date', 'asc')
    .get()
    .then((res) => {
      const plans = res.data as MealPlan[]
      rememberMealPlans(plans)
      mealMonthCache.set(cacheKey, plans)
      return plans
    })
  request.then(() => {
    pendingMealMonths.delete(cacheKey)
  }).catch(() => {
    pendingMealMonths.delete(cacheKey)
  })

  pendingMealMonths.set(cacheKey, request)
  return request
}

/** 同步读取已缓存的某月规划。 */
export function getCachedMonthMealPlans(year: number, month: number): MealPlan[] | null {
  return mealMonthCache.get(mealMonthCacheKey(year, month)) || null
}

/** 保存菜单规划（upsert） */
export async function saveMealPlan(plan: Omit<MealPlan, '_id' | '_openid'>): Promise<void> {
  await waitForAppReady()
  // 先查是否存在
  const res = await db.collection('meal_plans').where({ date: plan.date }).get()
  const now = new Date()
  if (res.data.length > 0) {
    const current = res.data[0] as MealPlan
    await db
      .collection('meal_plans')
      .doc(current._id!)
      .update({ data: { meals: plan.meals, updatedAt: now } })
    upsertMealPlanCache({ ...current, ...plan, updatedAt: now })
  } else {
    const addRes = await db.collection('meal_plans').add({
      data: { ...plan, createdAt: now, updatedAt: now },
    })
    upsertMealPlanCache({ ...plan, _id: addRes._id, createdAt: now, updatedAt: now } as MealPlan)
  }
}

/** 并行保存多天规划；传入已查询记录可省去每一天的重复查询。 */
export async function saveMealPlans(
  plans: Array<Omit<MealPlan, '_id' | '_openid'>>,
  existingPlans?: MealPlan[]
): Promise<void> {
  await waitForAppReady()
  if (plans.length === 0) return

  let existing = existingPlans
  if (!existing) {
    const dates = plans.map((plan) => plan.date)
    const res = await db.collection('meal_plans').where({ date: _.in(dates) }).get()
    existing = res.data as MealPlan[]
  }

  const existingMap = new Map(existing.map((plan) => [plan.date, plan]))
  const now = new Date()
  await Promise.all(plans.map(async (plan) => {
    const current = existingMap.get(plan.date)
    if (current?._id) {
      await db.collection('meal_plans').doc(current._id).update({
        data: { meals: plan.meals, updatedAt: now },
      })
      upsertMealPlanCache({ ...current, ...plan, updatedAt: now })
      return
    }
    const addRes = await db.collection('meal_plans').add({
      data: { ...plan, createdAt: now, updatedAt: now },
    })
    upsertMealPlanCache({ ...plan, _id: addRes._id, createdAt: now, updatedAt: now } as MealPlan)
  }))
}

/** 删除某天菜单规划 */
export async function deleteMealPlan(date: string): Promise<void> {
  await waitForAppReady()
  const res = await db.collection('meal_plans').where({ date }).get()
  if (res.data.length > 0) {
    await db.collection('meal_plans').doc(res.data[0]._id).remove()
  }
  removeMealPlanCache(date)
}

// ==================== 用户设置 ====================

/** 获取用户设置 */
export async function getUserSettings(): Promise<UserSettings | null> {
  await waitForAppReady()
  if (userSettingsCache !== undefined) return userSettingsCache
  const res = await db.collection('user_settings').get()
  userSettingsCache = res.data.length > 0 ? res.data[0] as UserSettings : null
  return userSettingsCache
}

/** 保存用户设置（upsert） */
export async function saveUserSettings(settings: Partial<UserSettings>): Promise<void> {
  await waitForAppReady()
  const res = await db.collection('user_settings').get()
  if (res.data.length > 0) {
    await db
      .collection('user_settings')
      .doc(res.data[0]._id)
      .update({ data: settings })
    userSettingsCache = { ...(res.data[0] as UserSettings), ...settings }
  } else {
    await db.collection('user_settings').add({ data: settings })
    userSettingsCache = settings as UserSettings
  }
}
