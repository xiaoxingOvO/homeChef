// pages/profile/profile.ts
import { formatDateDisplay, getToday, getWeekday } from '../../utils/util'
import { getDishes, getCategories, getUserSettings, getAllMealPlans } from '../../utils/db'

Page({
  data: {
    dishCount: 0,
    categoryCount: 0,
    emojiCount: 0,
    totalDays: 0,
    mostEaten: '—',

    showRankModal: false,
    rankList: [] as { name: string; emoji: string; count: number }[],

    showRecordsModal: false,
    recordsList: [] as { date: string; dateDisplay: string; weekday: string; total: number }[],
  },

  async onShow() {
    await this.loadStats()
  },

  async loadStats() {
    try {
      const [dishes, categories, settings] = await Promise.all([
        getDishes(),
        getCategories(),
        getUserSettings(),
      ])

      // 加载总规划天数
      const plans = await this.loadAllPlans()
      const totalDays = Object.keys(plans).length

      // 最常吃：按今天及之前的菜单记录统计，未来日期的规划不计入。
      const rankList = this.buildRankList(dishes, Object.values(plans))
      const mostEaten =
        rankList.length > 0
          ? rankList[0].name + ' · ' + rankList[0].count + '次'
          : '—'

      this.setData({
        dishCount: dishes.length,
        categoryCount: categories.length,
        emojiCount: settings?.customEmojis?.length || 0,
        totalDays,
        mostEaten,
        rankList,
      })
    } catch (err) {
      console.error('加载统计数据失败:', err)
    }
  },

  buildRankList(dishes: Dish[], plans: MealPlan[]): { name: string; emoji: string; count: number }[] {
    const today = getToday()
    const countMap: Record<string, number> = {}
    const dishMap = new Map(dishes.map((dish) => [dish.name, dish]))

    // 只统计当前已有菜品，已删除的菜品不再出现在排名中。
    dishes.forEach((dish) => { countMap[dish.name] = 0 })

    plans
      .filter((plan) => plan.date <= today)
      .forEach((plan) => {
        const dishesInDay = [
          ...(plan.meals?.breakfast || []),
          ...(plan.meals?.lunch || []),
          ...(plan.meals?.dinner || []),
        ]

        dishesInDay.forEach((entry) => {
          const separatorIndex = entry.indexOf(' ')
          const storedName = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : entry
          const matched = dishMap.get(storedName)
          if (matched) countMap[matched.name]++
        })
      })

    return dishes
      .map((dish) => ({
        name: dish.name,
        emoji: dish.emoji,
        count: countMap[dish.name] || 0,
      }))
      .filter((dish) => dish.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  },

  async loadAllPlans(): Promise<Record<string, MealPlan>> {
    try {
      const plans = await getAllMealPlans()
      const map: Record<string, MealPlan> = {}
      plans.forEach((p) => { map[p.date] = p })
      return map
    } catch {
      return {}
    }
  },

  // 导航
  goToDishManage() {
    wx.navigateTo({ url: '/pages/dish-manage/dish-manage' })
  },

  goToCategoryManage() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' })
  },

  goToEmojiManage() {
    wx.navigateTo({ url: '/pages/emoji-manage/emoji-manage' })
  },

  // 排名
  async openRanking() {
    const [dishes, plans] = await Promise.all([
      getDishes(),
      getAllMealPlans(),
    ])
    const rankList = this.buildRankList(dishes, plans)

    this.setData({
      rankList,
      showRankModal: true,
    })
  },

  closeRankModal() {
    this.setData({ showRankModal: false })
  },

  // 总记录
  async openTotalRecords() {
    const plans = await this.loadAllPlans()
    const dates = Object.keys(plans)
      .filter((d) => {
        const p = plans[d]
        return p && (p.meals.breakfast.length + p.meals.lunch.length + p.meals.dinner.length > 0)
      })
      .sort((a, b) => b.localeCompare(a))

    const recordsList = dates.map((d) => {
      const p = plans[d]
      const total = p.meals.breakfast.length + p.meals.lunch.length + p.meals.dinner.length
      return {
        date: d,
        dateDisplay: formatDateDisplay(d),
        weekday: getWeekday(d),
        total,
      }
    })

    this.setData({
      recordsList,
      showRecordsModal: true,
    })
  },

  closeRecordsModal() {
    this.setData({ showRecordsModal: false })
  },
})
