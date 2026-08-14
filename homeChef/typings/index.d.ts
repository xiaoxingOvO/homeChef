// ==================== 业务数据类型 ====================

/** 菜品 */
interface Dish {
  _id?: string
  _openid?: string
  name: string
  category: string
  emoji: string
  stars: number
  count: number
  image: string
  steps: string[]
  note: string
  seedOrder?: number
  createdAt?: Date
  updatedAt?: Date
}

/** 分类 */
interface Category {
  _id?: string
  _openid?: string
  name: string
  isSystem: boolean
  order?: number
  createdAt?: Date
}

/** 一餐的菜品 */
interface MealSlot {
  breakfast: string[]
  lunch: string[]
  dinner: string[]
}

/** 每日菜单规划 */
interface MealPlan {
  _id?: string
  _openid?: string
  date: string
  meals: MealSlot
  createdAt?: Date
  updatedAt?: Date
}

/** 用户设置 */
interface UserSettings {
  _id?: string
  _openid?: string
  customEmojis: string[]
}

/** App 全局数据 */
interface IAppOption {
  globalData: {
    openid: string
    cloudEnvId: string
    readyPromise: Promise<void>
    openTodayEditRequested: boolean
  }
  initializeApp(): Promise<void>
  getOpenId(): Promise<void>
}
