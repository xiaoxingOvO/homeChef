// pages/recipe/recipe.ts
import { getToday, MEALS } from '../../utils/util'
import {
  DB_QUERY_LIMIT,
  getCachedCategories,
  getCachedDishCount,
  getCachedDishesPage,
  getDishesPage,
  countDishes,
  getCategories,
  saveMealPlan,
  getMealPlans,
} from '../../utils/db'
import { resolveDishImages, resolveDishImagesFromCache } from '../../utils/image-cache'

let recipeSelectedIds = new Set<string>()
let recipeSelectedDishes = new Map<string, Dish>()
let recipeAllDishes: Array<Dish & { displayImage: string }> = []
let recipeSearchTimer: number | undefined
let recipeLoadToken = 0
const RECIPE_PAGE_SIZE = DB_QUERY_LIMIT

function buildRecipeQuery(data: { currentCategory: string; searchText: string }) {
  return {
    limit: RECIPE_PAGE_SIZE,
    category: data.currentCategory,
    search: data.searchText,
  }
}

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
    loadingMore: false,
    hasMore: true,
    totalCount: 0,
  },

  onShow() {
    this.renderCachedFirstPage()
    void this.loadData()
  },

  renderCachedFirstPage(): boolean {
    const query = buildRecipeQuery(this.data)
    const cachedDishes = getCachedDishesPage(query)
    const cachedTotal = getCachedDishCount(query)
    const cachedCategories = getCachedCategories()
    if (!cachedDishes && !cachedCategories && cachedTotal === null) return false

    const update: Record<string, any> = {}
    if (cachedCategories) {
      const catNames = cachedCategories.map((c) => c.name)
      update.categories = ['全部', ...catNames]
      update.currentCategory = catNames.includes(this.data.currentCategory)
        ? this.data.currentCategory
        : '全部'
    }
    if (cachedTotal !== null) update.totalCount = cachedTotal
    if (cachedDishes) {
      recipeAllDishes = resolveDishImagesFromCache(cachedDishes)
      update.hasMore = cachedDishes.length === RECIPE_PAGE_SIZE
      update.loading = false
    }

    this.setData(update, () => {
      if (cachedDishes) this.renderDishes(recipeAllDishes)
    })
    return !!cachedDishes
  },

  async loadData() {
    try {
      const token = ++recipeLoadToken
      const hasCachedFirstPage = this.renderCachedFirstPage()
      if (!hasCachedFirstPage) this.setData({ loading: true })
      const query = buildRecipeQuery(this.data)
      const [dishes, totalCount, categories] = await Promise.all([
        getDishesPage(query),
        countDishes(query),
        getCategories(),
      ])
      if (token !== recipeLoadToken) return
      const catNames = categories.map((c) => c.name)
      const currentCategory = catNames.includes(this.data.currentCategory)
        ? this.data.currentCategory
        : '全部'
      recipeAllDishes = await resolveDishImages(dishes)
      if (token !== recipeLoadToken) return
      this.setData({
        categories: ['全部', ...catNames],
        currentCategory,
        totalCount,
        hasMore: dishes.length === RECIPE_PAGE_SIZE,
      }, () => {
        this.renderDishes(recipeAllDishes)
        this.setData({ loading: false })
      })
    } catch (err) {
      console.error('加载菜谱失败:', err)
      this.setData({ loading: false })
    }
  },

  async loadFirstPage() {
    try {
      const token = ++recipeLoadToken
      const hasCachedFirstPage = this.renderCachedFirstPage()
      this.setData({
        loading: !hasCachedFirstPage,
        loadingMore: false,
        hasMore: hasCachedFirstPage ? this.data.hasMore : true,
      })
      const query = buildRecipeQuery(this.data)
      const [dishes, totalCount] = await Promise.all([
        getDishesPage(query),
        countDishes(query),
      ])
      if (token !== recipeLoadToken) return
      recipeAllDishes = await resolveDishImages(dishes)
      if (token !== recipeLoadToken) return
      this.setData({
        totalCount,
        hasMore: dishes.length === RECIPE_PAGE_SIZE,
      }, () => {
        this.renderDishes(recipeAllDishes)
        this.setData({ loading: false })
      })
    } catch (err) {
      console.error('加载菜谱失败:', err)
      this.setData({ loading: false })
    }
  },

  async loadMoreDishes(): Promise<boolean> {
    const token = recipeLoadToken
    if (this.data.loadingMore || !this.data.hasMore) return false
    this.setData({ loadingMore: true })
    try {
      const dishes = await getDishesPage({
        skip: recipeAllDishes.length,
        limit: RECIPE_PAGE_SIZE,
        category: this.data.currentCategory,
        search: this.data.searchText,
      })
      const resolved = await resolveDishImages(dishes)
      if (token !== recipeLoadToken) return false
      recipeAllDishes = [...recipeAllDishes, ...resolved]
      const hasMore = dishes.length === RECIPE_PAGE_SIZE
      this.setData({
        hasMore,
      }, () => {
        this.renderDishes(recipeAllDishes)
      })
      return hasMore
    } catch (err) {
      console.error('加载更多菜谱失败:', err)
      return false
    } finally {
      if (token === recipeLoadToken) this.setData({ loadingMore: false })
    }
  },

  renderDishes(allDishes: Dish[]) {
    const enhanced = allDishes.map((d) => ({
      ...d,
      selected: recipeSelectedIds.has(d._id!),
      starsText: '⭐'.repeat(d.stars),
    }))

    this.setData({ dishes: enhanced, selectedCount: recipeSelectedIds.size })
  },

  onSearch(e: any) {
    this.setData({ searchText: e.detail.value })
    if (recipeSearchTimer) clearTimeout(recipeSearchTimer)
    recipeSearchTimer = setTimeout(() => {
      this.loadFirstPage()
    }, 300) as unknown as number
  },

  selectCategory(e: any) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ currentCategory: cat }, () => {
      void this.loadFirstPage()
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
      recipeSelectedDishes.delete(id)
    } else {
      recipeSelectedIds.add(id)
      const dish = recipeAllDishes.find((item) => item._id === id)
      if (dish) recipeSelectedDishes.set(id, dish)
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

    const selectedDishes = [...recipeSelectedDishes.values()]

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
    recipeSelectedDishes = new Map()
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

  onReachBottom() {
    void this.loadMoreDishes()
  },
})
