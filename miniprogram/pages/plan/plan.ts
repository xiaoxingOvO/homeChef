// pages/plan/plan.ts
import {
  getToday, getWeekStart, formatDate, formatDateDisplay, getWeekday, isToday,
  MEALS, generateId,
} from '../../utils/util'
import {
  getMealPlans, saveMealPlan, saveMealPlans, deleteMealPlan, getDishes, getMonthMealPlans,
} from '../../utils/db'

Page({
  randomFillInProgress: false,

  data: {
    // 视图
    viewMode: 'week' as 'week' | 'history',

    // 周视图
    weekLabel: '',
    weekDays: [] as any[],
    weekOffset: 0,

    // 历史视图
    historyMonthLabel: '',
    historyList: [] as any[],
    historyMonthOffset: 0,

    // 日编辑弹窗
    showDayEdit: false,
    dayEditTitle: '',
    dayEditDate: '',
    dayEditSlots: [] as any[],

    // 菜品选择弹窗
    showDishPicker: false,
    dishSearch: '',
    filteredDishes: [] as Dish[],
    editingSlot: '',

    // 今日编辑弹窗（从首页进入）
    showTodayEdit: false,
    todayEditSlots: [] as any[],
    todayEditDate: '',

    // Toast
    toastShow: false,
    toastMsg: '',

    loading: true,
    randomFilling: false,
  },

  onLoad(options: any) {
    if (options?.action === 'editToday') {
      this.openTodayEdit()
    }
  },

  async onShow() {
    const app = getApp<IAppOption>()
    const shouldOpenTodayEdit = app.globalData.openTodayEditRequested
    if (shouldOpenTodayEdit) {
      app.globalData.openTodayEditRequested = false
    }

    if (this.data.viewMode === 'week') {
      await this.loadWeek()
    } else {
      await this.loadHistory()
    }

    if (shouldOpenTodayEdit) {
      await this.openTodayEdit()
    }
  },

  // ==================== 视图切换 ====================

  switchView(e: any) {
    const view = e.currentTarget.dataset.view
    this.setData({ viewMode: view })
    if (view === 'week') {
      this.loadWeek()
    } else {
      this.loadHistory()
    }
  },

  // ==================== 周视图 ====================

  async loadWeek() {
    const weekOffset = Math.max(0, Number(this.data.weekOffset) || 0)
    if (weekOffset !== this.data.weekOffset) {
      this.setData({ weekOffset })
    }
    const start = getWeekStart(weekOffset)
    const today = getToday()
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      dates.push(formatDate(d))
    }

    this.setData({
      weekLabel: formatDateDisplay(dates[0]) + ' - ' + formatDateDisplay(dates[6]),
    })

    try {
      const plans = await getMealPlans(dates)
      const planMap: Record<string, MealPlan> = {}
      plans.forEach((p) => { planMap[p.date] = p })

      const weekDays = dates.map((date) => {
        const plan = planMap[date]
        const preview: { icon: string; text: string }[] = []
        if (plan?.meals.breakfast.length) preview.push({ icon: '🌅', text: plan.meals.breakfast[0] })
        if (plan?.meals.lunch.length) preview.push({ icon: '🌞', text: plan.meals.lunch[0] })
        if (plan?.meals.dinner.length) preview.push({ icon: '🌙', text: plan.meals.dinner[0] })
        const hasPlan = preview.length > 0

        return {
          date,
          weekday: getWeekday(date),
          dateDisplay: formatDateDisplay(date),
          isToday: isToday(date),
          isPast: date < today,
          preview,
          hasPlan,
        }
      })

      this.setData({ weekDays, loading: false })
    } catch (err) {
      console.error('加载周视图失败:', err)
      this.setData({ loading: false })
    }
  },

  shiftWeek(e: any) {
    const delta = Number(e.currentTarget.dataset.delta)
    const currentOffset = Number(this.data.weekOffset) || 0
    const nextOffset = Math.max(0, currentOffset + delta)
    if (nextOffset === currentOffset) return
    this.setData({ weekOffset: nextOffset })
    this.loadWeek()
  },

  async clearWeek() {
    const today = getToday()
    const start = getWeekStart(this.data.weekOffset)
    const editableDates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const date = formatDate(d)
      if (date >= today) editableDates.push(date)
    }

    wx.showModal({
      title: '确认操作',
      content: this.data.weekOffset === 0
        ? '确定清空今天及本周后续日期的规划吗？过去的记录会保留。'
        : '确定清空这一周的规划吗？此操作不可撤销。',
      success: async (res) => {
        if (!res.confirm) return
        await Promise.all(editableDates.map(async (date) => {
          try {
            await deleteMealPlan(date)
          } catch (_) { /* 忽略不存在的 */ }
        }))
        this.loadWeek()
        this.showToast('已清空可规划日期')
      },
    })
  },

  async randomFillWeek() {
    if (this.randomFillInProgress) return
    this.randomFillInProgress = true
    this.setData({ randomFilling: true })

    const start = getWeekStart(this.data.weekOffset)
    const today = getToday()
    const dates: string[] = []
    const editableDates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const date = formatDate(d)
      dates.push(date)
      if (date >= today) editableDates.push(date)
    }

    try {
      // 菜品和本周规划同时读取，避免按天串行请求。
      const [dishes, existingPlans] = await Promise.all([
        getDishes(),
        getMealPlans(dates),
      ])
      if (dishes.length === 0) {
        this.showToast('请先添加菜品')
        return
      }

      const existingMap = new Map(existingPlans.map((plan) => [plan.date, plan]))
      const generatedPlans: Array<Omit<MealPlan, '_id' | '_openid'>> = []

      editableDates.forEach((date) => {
        const existing = existingMap.get(date)
        const existingCount = existing
          ? existing.meals.breakfast.length + existing.meals.lunch.length + existing.meals.dinner.length
          : 0
        if (existingCount > 0) return

        const shuffled = [...dishes].sort(() => Math.random() - 0.5)
        const count = 3 + Math.floor(Math.random() * 4)
        const selected = shuffled.slice(0, Math.min(count, shuffled.length))
        const third = Math.ceil(selected.length / 3)
        const plan = {
          date,
          meals: {
            breakfast: selected.slice(0, third).map((dish) => dish.emoji + ' ' + dish.name),
            lunch: selected.slice(third, third * 2).map((dish) => dish.emoji + ' ' + dish.name),
            dinner: selected.slice(third * 2).map((dish) => dish.emoji + ' ' + dish.name),
          },
        }
        generatedPlans.push(plan)
        existingMap.set(date, plan as MealPlan)
      })

      if (generatedPlans.length === 0) {
        this.showToast('本周已经规划完成')
        return
      }

      // 先更新页面，让用户立即看到结果，再并行写入云端。
      const weekDays = dates.map((date) => {
        const plan = existingMap.get(date)
        const preview: { icon: string; text: string }[] = []
        if (plan?.meals.breakfast.length) preview.push({ icon: '🌅', text: plan.meals.breakfast[0] })
        if (plan?.meals.lunch.length) preview.push({ icon: '🌞', text: plan.meals.lunch[0] })
        if (plan?.meals.dinner.length) preview.push({ icon: '🌙', text: plan.meals.dinner[0] })
        return {
          date,
          weekday: getWeekday(date),
          dateDisplay: formatDateDisplay(date),
          isToday: isToday(date),
          isPast: date < today,
          preview,
          hasPlan: preview.length > 0,
        }
      })
      this.setData({ weekDays })

      await saveMealPlans(generatedPlans, existingPlans)
      this.showToast('已随机填充本周')
    } catch (err) {
      console.error('随机填充失败:', err)
      await this.loadWeek()
      this.showToast('随机填充失败')
    } finally {
      this.randomFillInProgress = false
      this.setData({ randomFilling: false })
    }
  },

  // ==================== 历史视图 ====================

  async loadHistory() {
    const historyMonthOffset = Math.min(0, Number(this.data.historyMonthOffset) || 0)
    const now = new Date()
    now.setMonth(now.getMonth() + historyMonthOffset)
    const year = now.getFullYear()
    const month = now.getMonth()

    this.setData({
      historyMonthOffset,
      historyMonthLabel: year + '年' + (month + 1) + '月',
    })

    try {
      const plans = await getMonthMealPlans(year, month)
      const today = getToday()
      const historyList = plans
        .filter((plan) => plan.date < today)
        .map((plan) => ({
        date: plan.date,
        dateDisplay: formatDateDisplay(plan.date),
        weekday: getWeekday(plan.date),
        meals: MEALS
          .filter((m) => plan.meals[m.key]?.length > 0)
          .map((m) => ({
            key: m.key,
            icon: m.icon,
            label: m.label,
            dishes: plan.meals[m.key],
          })),
      }))

      this.setData({ historyList, loading: false })
    } catch (err) {
      console.error('加载历史失败:', err)
      this.setData({ loading: false })
    }
  },

  shiftHistoryMonth(e: any) {
    const delta = Number(e.currentTarget.dataset.delta)
    const currentOffset = Number(this.data.historyMonthOffset) || 0
    const nextOffset = Math.min(0, currentOffset + delta)
    if (nextOffset === currentOffset) return
    this.setData({ historyMonthOffset: nextOffset })
    this.loadHistory()
  },

  async copyHistoryToToday(e: any) {
    const date = e.currentTarget.dataset.date
    const [plans, currentDishes] = await Promise.all([
      getMealPlans([date]),
      getDishes(),
    ])
    if (plans.length === 0) {
      this.showToast('这一天没有数据')
      return
    }

    const plan = plans[0]
    const dishMap = new Map(currentDishes.map((dish) => [dish.name, dish]))
    let skippedCount = 0
    const filterExistingDishes = (entries: string[]): string[] => entries.flatMap((entry) => {
      const separatorIndex = entry.indexOf(' ')
      const storedName = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : entry
      const currentDish = dishMap.get(storedName)
      if (!currentDish) {
        skippedCount++
        return []
      }
      return [currentDish.emoji + ' ' + currentDish.name]
    })

    const meals: MealSlot = {
      breakfast: filterExistingDishes(plan.meals.breakfast || []),
      lunch: filterExistingDishes(plan.meals.lunch || []),
      dinner: filterExistingDishes(plan.meals.dinner || []),
    }
    const copiedCount = meals.breakfast.length + meals.lunch.length + meals.dinner.length
    if (copiedCount === 0) {
      this.showToast('历史菜品均已删除，无法复制')
      return
    }

    await saveMealPlan({
      date: getToday(),
      meals,
    })
    this.showToast(skippedCount > 0 ? '已复制，跳过 ' + skippedCount + ' 道已删除菜品' : '已复制到今日')
    this.loadWeek()
  },

  // ==================== 日编辑弹窗 ====================

  async openDayEdit(e: any) {
    const date = e.currentTarget.dataset.date
    if (date < getToday()) return
    const plans = await getMealPlans([date])
    const plan = plans[0]

    const slots = MEALS.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: m.label,
      dishes: plan?.meals?.[m.key] || [],
    }))

    this.setData({
      showDayEdit: true,
      dayEditDate: date,
      dayEditTitle: getWeekday(date) + ' ' + formatDateDisplay(date),
      dayEditSlots: slots,
    })
  },

  closeDayEdit() {
    this.setData({ showDayEdit: false })
    this.loadWeek()
  },

  async removeFromDayEdit(e: any) {
    const { slot, dish } = e.currentTarget.dataset
    const idx = this.data.dayEditSlots.findIndex((s: any) => s.key === slot)
    if (idx === -1) return
    const slots = [...this.data.dayEditSlots]
    slots[idx] = {
      ...slots[idx],
      dishes: slots[idx].dishes.filter((d: string) => d !== dish),
    }
    this.setData({ dayEditSlots: slots })

    // 同步保存
    await this.saveDayEditSlots(slots)
  },

  openAddDish(e: any) {
    const slot = e.currentTarget.dataset.slot
    this.setData({ editingSlot: slot, showDishPicker: true, dishSearch: '' })
    this.loadFilteredDishes()
  },

  async loadFilteredDishes() {
    const dishes = await getDishes()
    const search = this.data.dishSearch.toLowerCase()
    const filtered = dishes.filter((d) => d.name.includes(search))
    this.setData({ filteredDishes: filtered })
  },

  onDishSearch(e: any) {
    this.setData({ dishSearch: e.detail.value })
    this.loadFilteredDishes()
  },

  async addDishToSlot(e: any) {
    const id = e.currentTarget.dataset.id
    const dishes = await getDishes()
    const dish = dishes.find((d) => d._id === id)
    if (!dish) return

    const nameWithEmoji = dish.emoji + ' ' + dish.name
    const idx = this.data.dayEditSlots.findIndex(
      (s: any) => s.key === this.data.editingSlot
    )
    if (idx === -1) return

    const slots = [...this.data.dayEditSlots]
    if (!slots[idx].dishes.includes(nameWithEmoji)) {
      slots[idx] = {
        ...slots[idx],
        dishes: [...slots[idx].dishes, nameWithEmoji],
      }
    }

    this.setData({ dayEditSlots: slots, showDishPicker: false })
    await this.saveDayEditSlots(slots)
    this.showToast('已添加 ' + dish.name)
  },

  async saveDayEditSlots(slots: any[]) {
    if (this.data.dayEditDate < getToday()) {
      this.showToast('不能修改过去的规划')
      return
    }
    const meals: MealSlot = { breakfast: [], lunch: [], dinner: [] }
    slots.forEach((s: any) => {
      meals[s.key as keyof MealSlot] = s.dishes
    })
    await saveMealPlan({
      date: this.data.dayEditDate,
      meals,
    })
  },

  closeDishPicker() {
    this.setData({ showDishPicker: false })
  },

  // ==================== 今日编辑弹窗 ====================

  async openTodayEdit() {
    const today = getToday()
    const plans = await getMealPlans([today])
    const plan = plans[0]

    const slots = MEALS.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: m.label,
      dishes: plan?.meals?.[m.key] || [],
    }))

    this.setData({
      showTodayEdit: true,
      todayEditDate: today,
      todayEditSlots: slots,
    })
  },

  closeTodayEdit() {
    this.setData({ showTodayEdit: false })
  },

  async removeFromTodayEdit(e: any) {
    const { slot, dish } = e.currentTarget.dataset
    const idx = this.data.todayEditSlots.findIndex((s: any) => s.key === slot)
    if (idx === -1) return
    const slots = [...this.data.todayEditSlots]
    slots[idx] = {
      ...slots[idx],
      dishes: slots[idx].dishes.filter((d: string) => d !== dish),
    }
    this.setData({ todayEditSlots: slots })
  },

  openTodayAddDish(e: any) {
    const slot = e.currentTarget.dataset.slot
    this.setData({ editingSlot: slot, showDishPicker: true, dishSearch: '' })
    this.loadFilteredDishes()
  },

  async saveTodayEdit() {
    const meals: MealSlot = { breakfast: [], lunch: [], dinner: [] }
    this.data.todayEditSlots.forEach((s: any) => {
      meals[s.key as keyof MealSlot] = s.dishes
    })

    await saveMealPlan({
      date: getToday(),
      meals,
    })

    this.setData({ showTodayEdit: false })
    this.showToast('✅ 今日菜单已更新')
  },

  // ==================== Toast ====================

  showToast(msg: string) {
    this.setData({ toastMsg: msg, toastShow: true })
    setTimeout(() => {
      this.setData({ toastShow: false })
    }, 1500)
  },

  shortDate(dateStr: string): string {
    const d = new Date(dateStr)
    return (d.getMonth() + 1) + '/' + d.getDate()
  },

  noop() {},
})
