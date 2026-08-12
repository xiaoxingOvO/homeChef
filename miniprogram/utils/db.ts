/**
 * CloudBase 数据库操作
 */

const db = wx.cloud.database()
const _ = db.command

/** 等待 App 完成首次用户数据初始化，避免首屏查询早于示例数据写入。 */
async function waitForAppReady(): Promise<void> {
  const app = getApp<IAppOption>()
  if (app?.globalData?.readyPromise) {
    await app.globalData.readyPromise
  }
}

// ==================== 菜品 ====================

/** 获取所有菜品 */
export async function getDishes(): Promise<Dish[]> {
  await waitForAppReady()
  const res = await db.collection('dishes').get()
  return res.data as Dish[]
}

/** 添加菜品 */
export async function addDish(dish: Omit<Dish, '_id' | '_openid'>): Promise<string> {
  await waitForAppReady()
  const res = await db.collection('dishes').add({ data: dish })
  return res._id
}

/** 更新菜品 */
export async function updateDish(id: string, data: Partial<Dish>): Promise<void> {
  await waitForAppReady()
  await db.collection('dishes').doc(id).update({ data })
}

/** 删除菜品 */
export async function deleteDish(id: string): Promise<void> {
  await waitForAppReady()
  await db.collection('dishes').doc(id).remove()
}

/** 批量删除菜品 */
export async function batchDeleteDishes(ids: string[]): Promise<void> {
  await waitForAppReady()
  // CloudBase 不支持直接批量删除，逐个删除
  const promises = ids.map(id => db.collection('dishes').doc(id).remove())
  await Promise.all(promises)
}

/** 批量更新菜品分类 */
export async function batchUpdateCategory(ids: string[], category: string): Promise<void> {
  await waitForAppReady()
  const promises = ids.map(id =>
    db.collection('dishes').doc(id).update({ data: { category } })
  )
  await Promise.all(promises)
}

// ==================== 分类 ====================

/** 获取所有分类 */
export async function getCategories(): Promise<Category[]> {
  await waitForAppReady()
  const res = await db.collection('categories').limit(100).get()
  return (res.data as Category[])
    .map((category, index) => ({ category, index }))
    .sort((a, b) => {
      const aOrder = typeof a.category.order === 'number' ? a.category.order : a.index
      const bOrder = typeof b.category.order === 'number' ? b.category.order : b.index
      return aOrder - bOrder
    })
    .map(({ category }) => category)
}

/** 添加分类 */
export async function addCategory(category: Omit<Category, '_id' | '_openid'>): Promise<string> {
  await waitForAppReady()
  const res = await db.collection('categories').add({ data: category })
  return res._id
}

/** 删除分类 */
export async function deleteCategory(id: string): Promise<void> {
  await waitForAppReady()
  await db.collection('categories').doc(id).remove()
}

/** 更新分类名称 */
export async function updateCategoryName(id: string, name: string): Promise<void> {
  await waitForAppReady()
  await db.collection('categories').doc(id).update({ data: { name } })
}

/** 保存分类顺序 */
export async function updateCategoryOrders(categories: Category[]): Promise<void> {
  await waitForAppReady()
  await Promise.all(
    categories.map((category, order) =>
      db.collection('categories').doc(category._id!).update({ data: { order } })
    )
  )
}

// ==================== 菜单规划 ====================

/** 获取某天的菜单规划 */
export async function getMealPlan(date: string): Promise<MealPlan | null> {
  await waitForAppReady()
  const res = await db.collection('meal_plans').where({ date }).get()
  if (res.data.length > 0) return res.data[0] as MealPlan
  return null
}

/** 获取多天的菜单规划 */
export async function getMealPlans(dates: string[]): Promise<MealPlan[]> {
  await waitForAppReady()
  if (dates.length === 0) return []

  const batchSize = 20
  const batches: string[][] = []
  for (let i = 0; i < dates.length; i += batchSize) {
    batches.push(dates.slice(i, i + batchSize))
  }

  const results = await Promise.all(
    batches.map((batch) => db.collection('meal_plans').where({ date: _.in(batch) }).get())
  )
  return results.flatMap((result) => result.data as MealPlan[])
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

  return plans
}

/** 获取某月的菜单规划 */
export async function getMonthMealPlans(year: number, month: number): Promise<MealPlan[]> {
  await waitForAppReady()
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const endDate =
    month === 11
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 2).padStart(2, '0')}-01`
  const res = await db
    .collection('meal_plans')
    .where({ date: _.gte(startDate).and(_.lt(endDate)) })
    .orderBy('date', 'asc')
    .get()
  return res.data as MealPlan[]
}

/** 保存菜单规划（upsert） */
export async function saveMealPlan(plan: Omit<MealPlan, '_id' | '_openid'>): Promise<void> {
  await waitForAppReady()
  // 先查是否存在
  const res = await db.collection('meal_plans').where({ date: plan.date }).get()
  if (res.data.length > 0) {
    await db
      .collection('meal_plans')
      .doc(res.data[0]._id)
      .update({ data: { meals: plan.meals, updatedAt: new Date() } })
  } else {
    await db.collection('meal_plans').add({ data: plan })
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
  await Promise.all(plans.map((plan) => {
    const current = existingMap.get(plan.date)
    if (current?._id) {
      return db.collection('meal_plans').doc(current._id).update({
        data: { meals: plan.meals, updatedAt: now },
      })
    }
    return db.collection('meal_plans').add({
      data: { ...plan, createdAt: now, updatedAt: now },
    })
  }))
}

/** 删除某天菜单规划 */
export async function deleteMealPlan(date: string): Promise<void> {
  await waitForAppReady()
  const res = await db.collection('meal_plans').where({ date }).get()
  if (res.data.length > 0) {
    await db.collection('meal_plans').doc(res.data[0]._id).remove()
  }
}

// ==================== 用户设置 ====================

/** 获取用户设置 */
export async function getUserSettings(): Promise<UserSettings | null> {
  await waitForAppReady()
  const res = await db.collection('user_settings').get()
  if (res.data.length > 0) return res.data[0] as UserSettings
  return null
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
  } else {
    await db.collection('user_settings').add({ data: settings })
  }
}
