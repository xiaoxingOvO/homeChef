// pages/recipe/recipe.ts
import { getToday, MEALS } from '../../utils/util'
import { getDishes, getCategories, saveMealPlan, getMealPlans } from '../../utils/db'
import { resolveDishImages } from '../../utils/image-cache'

let recipeSelectedIds = new Set<string>()
let recipeAllDishes: Array<Dish & { displayImage: string }> = []

Page({
  data: {
    searchText: '',
    currentCategory: '全部',
    categories: ['全部'],
    dishes: [] as (Dish & { displayImage: string; selected: boolean; starsText: string })[],
    layoutMode: 'grid' as 'grid' | 'list',
    selectedCount: 0,
    showBatchModal: false,

    toastShow: false,
    toastMsg: '',
    loading: true,
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    try {
      const [dishes, categories] = await Promise.all([getDishes(), getCategories()])
      const catNames = categories.map((c) => c.name)
      const currentCategory = catNames.includes(this.data.currentCategory)
        ? this.data.currentCategory
        : '全部'
      recipeAllDishes = await resolveDishImages(dishes)
      this.setData({
        categories: ['全部', ...catNames],
        currentCategory,
      }, () => {
        this.renderDishes(recipeAllDishes)
        this.setData({ loading: false })
      })
    } catch (err) {
      console.error('加载菜谱失败:', err)
      this.setData({ loading: false })
    }
  },

  renderDishes(allDishes: Dish[]) {
    const { searchText, currentCategory } = this.data
    const filtered = allDishes.filter((d) => {
      const catMatch = currentCategory === '全部' || d.category === currentCategory
      const searchMatch = !searchText || d.name.includes(searchText.toLowerCase())
      return catMatch && searchMatch
    })

    const enhanced = filtered.map((d) => ({
      ...d,
      selected: recipeSelectedIds.has(d._id!),
      starsText: '⭐'.repeat(d.stars),
    }))

    this.setData({ dishes: enhanced, selectedCount: recipeSelectedIds.size })
  },

  onSearch(e: any) {
    this.setData({ searchText: e.detail.value }, () => {
      this.renderDishes(recipeAllDishes)
    })
  },

  selectCategory(e: any) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ currentCategory: cat }, () => {
      this.renderDishes(recipeAllDishes)
    })
  },

  switchLayout(e: any) {
    const mode = e.currentTarget.dataset.mode as 'grid' | 'list'
    if (mode === this.data.layoutMode) return
    this.setData({ layoutMode: mode })
  },

  toggleSelect(e: any) {
    const id = e.currentTarget.dataset.id
    if (recipeSelectedIds.has(id)) {
      recipeSelectedIds.delete(id)
    } else {
      recipeSelectedIds.add(id)
    }
    this.renderDishes(recipeAllDishes)
  },

  openDetail(e: any) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  onDishImageError(e: any) {
    const id = e.currentTarget.dataset.id
    const dishes = this.data.dishes.map((dish) =>
      dish._id === id ? { ...dish, displayImage: '' } : dish
    )
    this.setData({ dishes })
  },

  openBatchAdd() {
    if (recipeSelectedIds.size === 0) {
      this.showToast('请先勾选菜品')
      return
    }
    this.setData({ showBatchModal: true })
  },

  closeBatchModal() {
    this.setData({ showBatchModal: false })
  },

  async batchAddToMeal(e: any) {
    const mealKey: keyof MealSlot = e.currentTarget.dataset.meal
    const today = getToday()

    const existing = await getMealPlans([today])
    const currentMeals: MealSlot = existing[0]?.meals || {
      breakfast: [],
      lunch: [],
      dinner: [],
    }

    const allDishes = await getDishes()
    const selectedDishes = allDishes.filter((d) => recipeSelectedIds.has(d._id!))

    let added = 0
    selectedDishes.forEach((d) => {
      const nameWithEmoji = d.emoji + ' ' + d.name
      if (!currentMeals[mealKey].includes(nameWithEmoji)) {
        currentMeals[mealKey].push(nameWithEmoji)
        added++
      }
    })

    await saveMealPlan({ date: today, meals: currentMeals })

    // 清空选中
    recipeSelectedIds = new Set()
    this.loadData()
    this.setData({ showBatchModal: false })

    const mealLabel = MEALS.find((m) => m.key === mealKey)?.label || ''
    this.showToast('✅ 已添加 ' + added + ' 道菜到今日' + mealLabel)
  },

  showToast(msg: string) {
    this.setData({ toastMsg: msg, toastShow: true })
    setTimeout(() => {
      this.setData({ toastShow: false })
    }, 1500)
  },

  noop() {},
})
