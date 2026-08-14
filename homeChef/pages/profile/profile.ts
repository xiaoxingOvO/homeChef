// pages/profile/profile.ts
import { DEFAULT_EMOJIS, RECOMMENDED_EMOJIS, formatDateDisplay, getEmojiDesc, getToday, getWeekday } from '../../utils/util'
import {
  DB_QUERY_LIMIT,
  addCategory,
  batchDeleteDishes,
  batchUpdateCategory,
  countDishes,
  deleteCategory,
  deleteDish,
  getAllMealPlans,
  getCategories,
  getDishes,
  getDishesPage,
  getUserSettings,
  saveUserSettings,
  updateCategoryName,
  updateCategoryOrders,
  updateDish,
} from '../../utils/db'
import { resolveDishImages } from '../../utils/image-cache'

type ProfilePanel = 'menu' | 'dish' | 'category' | 'emoji'

type RankItem = { name: string; emoji: string; count: number }
type RecordItem = { date: string; dateDisplay: string; weekday: string; total: number }
type DishManageItem = Dish & { displayImage: string; selected: boolean; starsText: string }

let dishManageSelectedIds = new Set<string>()
let dishManageAllDishes: Array<Dish & { displayImage: string }> = []
let dishManageSearchTimer: number | undefined
let dishManageLoadToken = 0

let categoryManageLoadToken = 0
let categoryDragRects: Array<{ top: number; bottom: number }> = []
let categoryDragStartClientY = 0
let categoryDragTargetIndex = -1

let emojiManageLoadToken = 0
let rankLoadToken = 0

const MANAGE_PAGE_SIZE = DB_QUERY_LIMIT
const PROFILE_STATS_CACHE_KEY = 'dailyMenuProfileStats'

type ProfileStatsCache = {
  date: string
  dishCount: number
  categoryCount: number
  emojiCount: number
  totalDays: number
  mostEaten: string
  rankList: RankItem[]
}

function readProfileStatsCache(): ProfileStatsCache | null {
  const cached = wx.getStorageSync(PROFILE_STATS_CACHE_KEY)
  if (cached && typeof cached === 'object' && cached.date && Array.isArray(cached.rankList)) {
    return cached as ProfileStatsCache
  }
  return null
}

Page({
  addingCategoryInProgress: false,

  data: {
    currentPanel: 'menu' as ProfilePanel,

    dishCount: 0,
    categoryCount: 0,
    emojiCount: 0,
    totalDays: 0,
    mostEaten: '—',

    showRankModal: false,
    rankLoading: false,
    rankList: [] as RankItem[],

    showRecordsModal: false,
    recordsLoading: false,
    recordsList: [] as RecordItem[],

    toastShow: false,
    toastMsg: '',

    // 菜品管理
    dishManageSearchText: '',
    dishManageCurrentCategory: '全部',
    dishManageCategories: ['全部'],
    dishManageDishes: [] as DishManageItem[],
    dishManageSelectedCount: 0,
    dishManageShowCategoryModal: false,
    dishManageLoading: false,
    dishManageLoadingMore: false,
    dishManageHasMore: true,
    dishManageLoaded: false,

    // 分类管理
    categoryManageCategories: [] as Category[],
    categoryManageShowAddModal: false,
    categoryManageNewCatName: '',
    categoryManageAdding: false,
    categoryManageShowEditModal: false,
    categoryManageEditingCatId: '',
    categoryManageEditingCatOldName: '',
    categoryManageEditingCatName: '',
    categoryManageReordering: false,
    categoryManageDragActive: false,
    categoryManageDraggingIndex: -1,
    categoryManageDragTranslateY: 0,
    categoryManageLoading: false,
    categoryManageLoaded: false,

    // 图标管理
    emojiManageCustomEmojis: DEFAULT_EMOJIS,
    emojiManageSearchText: '',
    emojiManageFilteredRecommended: [] as string[],
    emojiManageShowAddModal: false,
    emojiManageNewEmoji: '',
    emojiManageLoading: false,
    emojiManageLoaded: false,
  },

  async onShow() {
    setTimeout(() => {
      void this.loadStats()
    }, 0)
  },

  // ==================== 总览 ====================

  async loadStats() {
    try {
      this.prewarmManageData()
      const cached = readProfileStatsCache()
      if (cached && cached.date === getToday()) {
        this.setData({
          dishCount: cached.dishCount,
          categoryCount: cached.categoryCount,
          emojiCount: cached.emojiCount,
          totalDays: cached.totalDays,
          mostEaten: cached.mostEaten,
        })
        return
      }

      const [dishCount, categories, settings] = await Promise.all([
        countDishes(),
        getCategories(),
        getUserSettings(),
      ])

      this.setData({
        dishCount,
        categoryCount: categories.length,
        emojiCount: settings?.customEmojis?.length || 0,
      })

      const plans = await this.loadAllPlans()
      const totalDays = Object.keys(plans).length
      const dishes = await getDishes()
      const rankList = this.buildRankList(dishes, Object.values(plans))
      const mostEaten =
        rankList.length > 0
          ? rankList[0].name + ' · ' + rankList[0].count + '次'
          : '—'

      this.setData({ totalDays, mostEaten })

      wx.setStorageSync(PROFILE_STATS_CACHE_KEY, {
        date: getToday(),
        dishCount,
        categoryCount: categories.length,
        emojiCount: settings?.customEmojis?.length || 0,
        totalDays,
        mostEaten,
        rankList,
      } as ProfileStatsCache)
    } catch (err) {
      console.error('加载统计数据失败:', err)
    }
  },

  prewarmManageData() {
    void Promise.all([
      getDishesPage({ limit: 1 }),
      getCategories(),
      getUserSettings(),
    ]).catch(() => {})
  },

buildRankList(dishes: Dish[], plans: MealPlan[]): RankItem[] {
    const today = getToday()
    const countMap: Record<string, number> = {}
    const dishMap = new Map(dishes.map((dish) => [dish.name, dish]))

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

  enterPanel(panel: ProfilePanel) {
    if (this.data.currentPanel === panel) return
    this.setData({ currentPanel: panel })

    if (panel === 'dish') {
      void this.ensureDishManageLoaded()
    } else if (panel === 'category') {
      void this.ensureCategoryManageLoaded()
    } else if (panel === 'emoji') {
      void this.ensureEmojiManageLoaded()
    }
  },

  backToMenu() {
    this.setData({ currentPanel: 'menu' })
  },

  goToDishManage() {
    this.enterPanel('dish')
  },

  goToCategoryManage() {
    this.enterPanel('category')
  },

  goToEmojiManage() {
    this.enterPanel('emoji')
  },

  // ==================== 菜品管理 ====================

  async ensureDishManageLoaded() {
    if (!this.data.dishManageLoaded) {
      this.setData({ dishManageLoading: true })
    }
    await this.loadDishManageData()
  },

  async loadDishManageData() {
    const token = ++dishManageLoadToken
    try {
      this.setData({ dishManageLoading: true, dishManageLoadingMore: false })
      const [dishes, categories] = await Promise.all([
        getDishesPage({
          limit: MANAGE_PAGE_SIZE,
          category: this.data.dishManageCurrentCategory,
          search: this.data.dishManageSearchText,
        }),
        getCategories(),
      ])
      if (token !== dishManageLoadToken) return
      const catNames = categories.map((c) => c.name)
      const currentCategory = catNames.includes(this.data.dishManageCurrentCategory)
        ? this.data.dishManageCurrentCategory
        : '全部'
      dishManageAllDishes = await resolveDishImages(dishes)
      if (token !== dishManageLoadToken) return
      this.setData({
        dishManageCategories: ['全部', ...catNames],
        dishManageCurrentCategory: currentCategory,
        dishManageHasMore: dishes.length === MANAGE_PAGE_SIZE,
        dishManageLoaded: true,
      }, () => {
        this.filterDishManageDishes(dishManageAllDishes)
        this.setData({ dishManageLoading: false })
      })
    } catch (err) {
      console.error('加载菜品失败:', err)
      this.setData({ dishManageLoading: false })
    }
  },

  async loadDishManageFirstPage() {
    const token = ++dishManageLoadToken
    try {
      this.setData({ dishManageLoading: true, dishManageLoadingMore: false, dishManageHasMore: true })
      const dishes = await getDishesPage({
        limit: MANAGE_PAGE_SIZE,
        category: this.data.dishManageCurrentCategory,
        search: this.data.dishManageSearchText,
      })
      if (token !== dishManageLoadToken) return
      dishManageAllDishes = await resolveDishImages(dishes)
      if (token !== dishManageLoadToken) return
      this.setData({
        dishManageHasMore: dishes.length === MANAGE_PAGE_SIZE,
        dishManageLoaded: true,
      }, () => {
        this.filterDishManageDishes(dishManageAllDishes)
        this.setData({ dishManageLoading: false })
      })
    } catch (err) {
      console.error('加载菜品失败:', err)
      this.setData({ dishManageLoading: false })
    }
  },

  async loadDishManageMore() {
    if (this.data.dishManageLoadingMore || !this.data.dishManageHasMore) return
    this.setData({ dishManageLoadingMore: true })
    try {
      const dishes = await getDishesPage({
        skip: dishManageAllDishes.length,
        limit: MANAGE_PAGE_SIZE,
        category: this.data.dishManageCurrentCategory,
        search: this.data.dishManageSearchText,
      })
      const resolved = await resolveDishImages(dishes)
      dishManageAllDishes = [...dishManageAllDishes, ...resolved]
      this.setData({
        dishManageHasMore: dishes.length === MANAGE_PAGE_SIZE,
      }, () => {
        this.filterDishManageDishes(dishManageAllDishes)
      })
    } catch (err) {
      console.error('加载更多失败:', err)
    } finally {
      this.setData({ dishManageLoadingMore: false })
    }
  },

  filterDishManageDishes(allDishes: Array<Dish & { displayImage: string }>) {
    const enhanced = allDishes.map((d) => ({
      ...d,
      selected: dishManageSelectedIds.has(d._id!),
      starsText: '⭐'.repeat(d.stars),
    }))

    this.setData({
      dishManageDishes: enhanced,
      dishManageSelectedCount: dishManageSelectedIds.size,
    })
  },

  onDishManageSearch(e: any) {
    this.setData({ dishManageSearchText: e.detail.value })
    if (dishManageSearchTimer) clearTimeout(dishManageSearchTimer)
    dishManageSearchTimer = setTimeout(() => {
      void this.loadDishManageFirstPage()
    }, 300) as unknown as number
  },

  selectDishManageCategory(e: any) {
    this.setData({ dishManageCurrentCategory: e.currentTarget.dataset.cat }, () => {
      void this.loadDishManageFirstPage()
    })
  },

  toggleDishSelect(e: any) {
    const id = e.currentTarget.dataset.id
    if (dishManageSelectedIds.has(id)) {
      dishManageSelectedIds.delete(id)
    } else {
      dishManageSelectedIds.add(id)
    }
    this.filterDishManageDishes(dishManageAllDishes)
  },

  openAddDish() {
    wx.navigateTo({ url: '/pages/detail/detail?id=new' })
  },

  editDish(e: any) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  onDishImageError(e: any) {
    const id = e.currentTarget.dataset.id
    const dishes = this.data.dishManageDishes.map((dish) =>
      dish._id === id ? { ...dish, displayImage: '' } : dish
    )
    this.setData({ dishManageDishes: dishes })
  },

  deleteOne(e: any) {
    const { id, name } = e.currentTarget.dataset
    wx.showModal({
      title: '确认删除',
      content: '确定删除「' + name + '」吗？',
      success: async (res) => {
        if (!res.confirm) return
        await deleteDish(id)
        this.showToast('已删除「' + name + '」')
        await this.loadDishManageData()
      },
    })
  },

  async batchDelete() {
    if (dishManageSelectedIds.size === 0) return
    wx.showModal({
      title: '确认删除',
      content: '确定删除选中的 ' + dishManageSelectedIds.size + ' 道菜品吗？',
      success: async (res) => {
        if (!res.confirm) return
        const count = dishManageSelectedIds.size
        await batchDeleteDishes([...dishManageSelectedIds])
        dishManageSelectedIds = new Set()
        await this.loadDishManageData()
        this.showToast('已删除 ' + count + ' 道菜品')
      },
    })
  },

  openDishBatchCategory() {
    if (dishManageSelectedIds.size === 0) {
      this.showToast('请先选择菜品')
      return
    }
    this.setData({ dishManageShowCategoryModal: true })
  },

  closeDishCategoryModal() {
    this.setData({ dishManageShowCategoryModal: false })
  },

  async confirmDishBatchCategory(e: any) {
    const cat = e.currentTarget.dataset.cat
    const count = dishManageSelectedIds.size
    await batchUpdateCategory([...dishManageSelectedIds], cat)
    dishManageSelectedIds = new Set()
    this.setData({ dishManageShowCategoryModal: false })
    await this.loadDishManageData()
    this.showToast('已修改 ' + count + ' 道菜的分类为「' + cat + '」')
  },

  // ==================== 分类管理 ====================

  async ensureCategoryManageLoaded() {
    if (!this.data.categoryManageLoaded) {
      this.setData({ categoryManageLoading: true })
    }
    await this.loadCategoryManageData()
  },

  async loadCategoryManageData() {
    const token = ++categoryManageLoadToken
    try {
      const categories = await getCategories()
      if (token !== categoryManageLoadToken) return
      this.setData({
        categoryManageCategories: categories,
        categoryManageLoading: false,
        categoryManageLoaded: true,
      })
    } catch (err) {
      console.error('加载分类失败:', err)
      this.setData({ categoryManageLoading: false })
    }
  },

  openCategoryAdd() {
    this.setData({ categoryManageShowAddModal: true, categoryManageNewCatName: '' })
  },

  closeCategoryAdd() {
    this.setData({ categoryManageShowAddModal: false })
  },

  onCategoryNameInput(e: any) {
    this.setData({ categoryManageNewCatName: e.detail.value })
  },

  async confirmCategoryAdd() {
    if (this.addingCategoryInProgress) return

    const name = this.data.categoryManageNewCatName.trim()
    if (!name) {
      this.showToast('请输入名称')
      return
    }
    this.addingCategoryInProgress = true
    this.setData({ categoryManageAdding: true })
    try {
      const latestCategories = await getCategories()
      if (latestCategories.some((category) => category.name === name)) {
        this.showToast('分类已存在')
        return
      }

      const lastOrder = latestCategories.reduce((max, category, index) => {
        const order = typeof category.order === 'number' ? category.order : index
        return Math.max(max, order)
      }, -1)

      await addCategory({
        name,
        isSystem: false,
        order: lastOrder + 1,
        createdAt: new Date(),
      })
      this.setData({ categoryManageShowAddModal: false, categoryManageNewCatName: '' })
      await this.loadCategoryManageData()
      this.showToast('已添加分类「' + name + '」')
    } catch (err) {
      console.error('新增分类失败:', err)
      this.showToast('新增失败')
    } finally {
      this.addingCategoryInProgress = false
      this.setData({ categoryManageAdding: false })
    }
  },

  openCategoryEdit(e: any) {
    const { id, name, system } = e.currentTarget.dataset
    if (system) return

    this.setData({
      categoryManageShowEditModal: true,
      categoryManageEditingCatId: id,
      categoryManageEditingCatOldName: name,
      categoryManageEditingCatName: name,
    })
  },

  closeCategoryEdit() {
    this.setData({ categoryManageShowEditModal: false })
  },

  onCategoryEditNameInput(e: any) {
    this.setData({ categoryManageEditingCatName: e.detail.value })
  },

  async confirmCategoryEdit() {
    const { categoryManageEditingCatId, categoryManageEditingCatOldName } = this.data
    const name = this.data.categoryManageEditingCatName.trim()
    if (!name) {
      this.showToast('请输入名称')
      return
    }
    if (name === categoryManageEditingCatOldName) {
      this.setData({ categoryManageShowEditModal: false })
      return
    }

    try {
      const latestCategories = await getCategories()
      const duplicate = latestCategories.some(
        (category) => category._id !== categoryManageEditingCatId && category.name === name
      )
      if (duplicate) {
        this.showToast('分类名称已存在')
        return
      }

      const dishes = await getDishes()
      const affectedDishes = dishes.filter((dish) => dish.category === categoryManageEditingCatOldName)

      await updateCategoryName(categoryManageEditingCatId, name)
      await Promise.all(
        affectedDishes.map((dish) => updateDish(dish._id!, { category: name }))
      )

      this.setData({ categoryManageShowEditModal: false })
      await this.loadCategoryManageData()
      this.showToast('分类名称已更新')
    } catch (err) {
      console.error('修改分类名称失败:', err)
      this.showToast('修改失败')
    }
  },

  onCategoryDragStart(e: any) {
    if (this.data.categoryManageReordering) return

    const index = Number(e.currentTarget.dataset.index)
    const clientY = e.touches?.[0]?.clientY
    categoryDragStartClientY = typeof clientY === 'number' ? clientY : 0
    categoryDragTargetIndex = index
    this.setData({
      categoryManageDragActive: true,
      categoryManageDraggingIndex: index,
      categoryManageDragTranslateY: 0,
    })
    this.createSelectorQuery()
      .selectAll('.category-item')
      .boundingClientRect((rects: any) => {
        if (!this.data.categoryManageDragActive || !rects?.length) return
        categoryDragRects = rects.map((rect: { top: number; bottom: number }) => ({
          top: rect.top,
          bottom: rect.bottom,
        }))
        if (!categoryDragStartClientY && categoryDragRects[index]) {
          const rect = categoryDragRects[index]
          categoryDragStartClientY = (rect.top + rect.bottom) / 2
        }
      })
      .exec()
    wx.vibrateShort({ type: 'light' })
  },

  onCategoryDragMove(e: any) {
    if (!this.data.categoryManageDragActive || this.data.categoryManageReordering) return

    const clientY = e.touches?.[0]?.clientY
    if (typeof clientY !== 'number' || categoryDragRects.length === 0) return

    let targetIndex = categoryDragRects.findIndex(
      (rect) => clientY < (rect.top + rect.bottom) / 2
    )
    if (targetIndex === -1) targetIndex = categoryDragRects.length - 1
    categoryDragTargetIndex = targetIndex
    this.setData({ categoryManageDragTranslateY: clientY - categoryDragStartClientY })
  },

  async onCategoryDragEnd() {
    if (!this.data.categoryManageDragActive || this.data.categoryManageReordering) return

    const categories = [...this.data.categoryManageCategories]
    const fromIndex = this.data.categoryManageDraggingIndex
    const targetIndex = categoryDragTargetIndex
    if (fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex) {
      const [moved] = categories.splice(fromIndex, 1)
      categories.splice(targetIndex, 0, moved)
    }

    categoryDragRects = []
    categoryDragStartClientY = 0
    categoryDragTargetIndex = -1
    this.setData({
      categoryManageCategories: categories,
      categoryManageDragActive: false,
      categoryManageDraggingIndex: -1,
      categoryManageDragTranslateY: 0,
      categoryManageReordering: true,
    })
    try {
      await updateCategoryOrders(categories)
      this.showToast('顺序已保存')
    } catch (err) {
      console.error('保存分类顺序失败:', err)
      await this.loadCategoryManageData()
      this.showToast('顺序保存失败')
    } finally {
      this.setData({ categoryManageReordering: false })
    }
  },

  async deleteCategoryItem(e: any) {
    const { id, name, system } = e.currentTarget.dataset
    if (system) return

    wx.showModal({
      title: '确认删除',
      content: '确定删除分类「' + name + '」吗？该分类下的菜品将自动归入「其他」。',
      success: async (res) => {
        if (!res.confirm) return

        const dishes = await getDishes()
        const toUpdate = dishes.filter((d) => d.category === name)
        for (const d of toUpdate) {
          await updateDish(d._id!, { category: '其他' })
        }

        await deleteCategory(id)
        const categories = await getCategories()
        await updateCategoryOrders(categories)
        this.setData({ categoryManageCategories: categories })
        this.showToast('已删除「' + name + '」，菜品已归入「其他」')
      },
    })
  },

  // ==================== 图标管理 ====================

  async ensureEmojiManageLoaded() {
    if (!this.data.emojiManageLoaded) {
      this.setData({ emojiManageLoading: true })
    }
    await this.loadEmojiManageData()
  },

  async loadEmojiManageData() {
    const token = ++emojiManageLoadToken
    try {
      const settings = await getUserSettings()
      if (token !== emojiManageLoadToken) return
      const customEmojis = settings?.customEmojis?.length
        ? settings.customEmojis
        : DEFAULT_EMOJIS
      this.setData({ emojiManageCustomEmojis: customEmojis }, () => {
        this.filterEmojiManageRecommended()
      })
      this.setData({ emojiManageLoading: false, emojiManageLoaded: true })
    } catch (err) {
      console.error('加载图标失败:', err)
      this.filterEmojiManageRecommended()
      this.setData({ emojiManageLoading: false })
    }
  },

  filterEmojiManageRecommended() {
    const { emojiManageCustomEmojis, emojiManageSearchText } = this.data
    const mySet = new Set(emojiManageCustomEmojis)

    const list = RECOMMENDED_EMOJIS.filter((e) => {
      if (mySet.has(e)) return false
      if (emojiManageSearchText) {
        const desc = getEmojiDesc(e)
        return desc.includes(emojiManageSearchText.toLowerCase()) || e.includes(emojiManageSearchText)
      }
      return true
    })

    this.setData({ emojiManageFilteredRecommended: list })
  },

  onEmojiManageSearch(e: any) {
    this.setData({ emojiManageSearchText: e.detail.value })
    this.filterEmojiManageRecommended()
  },

  async saveEmojiManageCustomEmojis() {
    await saveUserSettings({ customEmojis: this.data.emojiManageCustomEmojis })
  },

  async addEmojiToManage(e: any) {
    const emoji = e.currentTarget.dataset.emoji
    if (this.data.emojiManageCustomEmojis.includes(emoji)) {
      this.showToast('该图标已在「我的图标」中')
      return
    }
    const customEmojis = [...this.data.emojiManageCustomEmojis, emoji]
    this.setData({ emojiManageCustomEmojis: customEmojis })
    await this.saveEmojiManageCustomEmojis()
    this.filterEmojiManageRecommended()
    this.showToast('已添加 ' + emoji + ' 到「我的图标」')
  },

  async removeEmojiFromManage(e: any) {
    const emoji = e.currentTarget.dataset.emoji
    if (this.data.emojiManageCustomEmojis.length <= 4) {
      this.showToast('至少保留4个图标')
      return
    }

    wx.showModal({
      title: '移除图标',
      content: '确定从「我的图标」中移除 ' + emoji + ' 吗？移除后仍可在推荐图标库中找回。',
      success: async (res) => {
        if (!res.confirm) return
        const customEmojis = this.data.emojiManageCustomEmojis.filter((e: string) => e !== emoji)
        this.setData({ emojiManageCustomEmojis: customEmojis })
        await this.saveEmojiManageCustomEmojis()
        this.filterEmojiManageRecommended()
        this.showToast('已移除图标 ' + emoji)
      },
    })
  },

  openEmojiManageAdd() {
    this.setData({ emojiManageShowAddModal: true, emojiManageNewEmoji: '' })
  },

  closeEmojiManageAdd() {
    this.setData({ emojiManageShowAddModal: false })
  },

  onEmojiManageInput(e: any) {
    this.setData({ emojiManageNewEmoji: e.detail.value })
  },

  async confirmEmojiManageAdd() {
    const emoji = this.data.emojiManageNewEmoji.trim()
    if (!emoji) {
      this.showToast('请输入图标')
      return
    }
    if (this.data.emojiManageCustomEmojis.includes(emoji)) {
      this.showToast('该图标已在「我的图标」中')
      return
    }
    const customEmojis = [...this.data.emojiManageCustomEmojis, emoji]
    this.setData({ emojiManageCustomEmojis: customEmojis, emojiManageShowAddModal: false })
    await this.saveEmojiManageCustomEmojis()
    this.filterEmojiManageRecommended()
    this.showToast('已添加图标 ' + emoji)
  },

  // ==================== 排名 / 记录 ====================

  async openRanking() {
    this.setData({ showRankModal: true, rankLoading: true })
    const cached = readProfileStatsCache()
    if (cached && cached.date === getToday() && cached.rankList.length > 0) {
      this.setData({ rankList: cached.rankList, rankLoading: false })
    }

    const token = ++rankLoadToken
    const [dishes, plans] = await Promise.all([
      getDishes(),
      getAllMealPlans(),
    ])
    const rankList = this.buildRankList(dishes, plans)
    if (token !== rankLoadToken) return

    this.setData({
      rankList,
      showRankModal: true,
      rankLoading: false,
    })
    if (cached && cached.date === getToday()) {
      wx.setStorageSync(PROFILE_STATS_CACHE_KEY, { ...cached, rankList })
    }
  },

  closeRankModal() {
    this.setData({ showRankModal: false })
  },

  async openTotalRecords() {
    this.setData({ showRecordsModal: true, recordsLoading: true })
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
      recordsLoading: false,
    })
  },

  closeRecordsModal() {
    this.setData({ showRecordsModal: false })
  },

  // ==================== 通用 ====================

  showToast(msg: string) {
    this.setData({ toastMsg: msg, toastShow: true })
    setTimeout(() => {
      this.setData({ toastShow: false })
    }, 1500)
  },

  noop() {},

  onReachBottom() {
    if (this.data.currentPanel === 'dish') {
      void this.loadDishManageMore()
    }
  },
})
