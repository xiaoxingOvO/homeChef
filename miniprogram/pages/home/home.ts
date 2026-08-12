// pages/home/home.ts
import {
  getToday, formatDateDisplay, getWeekday, getWeekStart, formatDate, MEALS,
} from '../../utils/util'
import { getDishes, getMealPlans } from '../../utils/db'

const HOME_CACHE_KEY = 'dailyMenuHomeCache'

type HomeCache = {
  today: string
  weekDates: string[]
  plans: MealPlan[]
}

Page({
  data: {
    dateDisplay: '',
    todayMeals: MEALS.map((meal) => ({
      key: meal.key,
      icon: meal.icon,
      label: meal.label,
      dishes: [],
    })) as { key: string; icon: string; label: string; dishes: string[] }[],
    recentEaten: [] as string[],
    weekPreview: Array.from({ length: 7 }, () => ({ cls: 'gray' })) as { cls: string }[],
    loading: false,
  },

  async onShow() {
    this.renderCachedHome()
    await this.loadAll()
  },

  buildDates() {
    const today = getToday()
    const start = getWeekStart(0)
    const weekDates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      weekDates.push(formatDate(d))
    }

    // 最近吃过只看今天及之前 6 天，共 7 个自然日。
    const recentDates: string[] = [today]
    const rd = new Date()
    for (let i = 1; i < 7; i++) {
      rd.setDate(rd.getDate() - 1)
      recentDates.push(formatDate(new Date(rd)))
    }

    // 本周和最近 7 天有重叠，只查询去重后的日期，最多 13 个。
    return {
      today,
      weekDates,
      recentDates,
      allDates: [...new Set([...weekDates, ...recentDates])],
    }
  },

  renderCachedHome() {
    const { today, weekDates, recentDates } = this.buildDates()
    this.setData({ dateDisplay: formatDateDisplay(today) + ' ' + getWeekday(today) })

    const cache = wx.getStorageSync(HOME_CACHE_KEY) as HomeCache
    if (!cache || cache.today !== today || cache.weekDates?.[0] !== weekDates[0]) return

    const planMap: Record<string, MealPlan> = {}
    cache.plans.forEach((plan) => { planMap[plan.date] = plan })
    this.renderToday(planMap[today])
    this.renderWeekPreview(weekDates, planMap)
    this.renderRecentEaten(recentDates, planMap)
    this.setData({ loading: false })
  },

  async loadAll() {
    const { today, weekDates, recentDates, allDates } = this.buildDates()
    this.setData({ dateDisplay: formatDateDisplay(today) + ' ' + getWeekday(today) })

    try {
      const plans = await getMealPlans(allDates)
      const planMap: Record<string, MealPlan> = {}
      plans.forEach((p) => { planMap[p.date] = p })

      // 渲染今日菜单
      this.renderToday(planMap[today])

      // 渲染本周预览
      this.renderWeekPreview(weekDates, planMap)

      // 渲染最近吃过
      this.renderRecentEaten(recentDates, planMap)

      wx.setStorageSync(HOME_CACHE_KEY, { today, weekDates, plans } as HomeCache)

      this.setData({ loading: false })
    } catch (err) {
      console.error('加载首页数据失败:', err)
      this.setData({ loading: false })
    }
  },

  renderToday(plan: MealPlan | undefined) {
    const meals = MEALS.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: m.label,
      dishes: plan?.meals?.[m.key] || [],
    }))
    this.setData({ todayMeals: meals })
  },

  renderWeekPreview(dates: string[], planMap: Record<string, MealPlan>) {
    const preview = dates.map((date) => {
      const p = planMap[date]
      const hasPlan =
        p && (p.meals.breakfast.length + p.meals.lunch.length + p.meals.dinner.length > 0)
      return {
        cls: hasPlan ? 'green' : 'gray',
      }
    })
    this.setData({ weekPreview: preview })
  },

  renderRecentEaten(recentDates: string[], planMap: Record<string, MealPlan>) {
    const today = getToday()
    const recentDateSet = new Set(recentDates)
    const dates = Object.keys(planMap)
      .filter((d) => {
        const p = planMap[d]
        return recentDateSet.has(d) && d <= today && p && (
          p.meals.breakfast.length + p.meals.lunch.length + p.meals.dinner.length > 0
        )
      })
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 5)

    const eaten = dates.map((d) => {
      const p = planMap[d]
      const all = [...p.meals.breakfast, ...p.meals.lunch, ...p.meals.dinner]
      const first = all[0] || '—'
      const daysAgo = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
      const label = daysAgo === 0 ? '今天' : daysAgo + '天前'
      return first + ' · ' + label
    })

    this.setData({ recentEaten: eaten })
  },

  // 编辑今日菜单
  openEditToday() {
    const app = getApp<IAppOption>()
    app.globalData.openTodayEditRequested = true
    wx.switchTab({ url: '/pages/plan/plan' })
  },

  async openTodayDish(e: any) {
    const entry = String(e.currentTarget.dataset.dish || '')
    const separatorIndex = entry.indexOf(' ')
    const name = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : entry
    if (!name) return

    try {
      const dishes = await getDishes()
      const dish = dishes.find((item) => item.name === name)
      if (!dish?._id) {
        wx.showToast({ title: '菜品已不存在', icon: 'none' })
        return
      }
      wx.navigateTo({ url: '/pages/detail/detail?id=' + dish._id })
    } catch (err) {
      console.error('打开菜品详情失败:', err)
      wx.showToast({ title: '打开详情失败', icon: 'none' })
    }
  },

})
