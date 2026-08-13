// pages/dish-manage/dish-manage.ts
import { DB_QUERY_LIMIT, getDishesPage, getCategories, deleteDish, batchDeleteDishes, batchUpdateCategory } from '../../utils/db'
import { resolveDishImages } from '../../utils/image-cache'

let managedSelectedIds = new Set<string>()
let managedAllDishes: Array<Dish & { displayImage: string }> = []
let managedSearchTimer: number | undefined
const MANAGE_PAGE_SIZE = DB_QUERY_LIMIT

Page({
  data: {
    searchText: '',
    currentCategory: '全部',
    categories: ['全部'],
    dishes: [] as (Dish & { displayImage: string; selected: boolean; starsText: string })[],
    selectedCount: 0,
    showCategoryModal: false,

    toastShow: false,
    toastMsg: '',
    loading: true,
    loadingMore: false,
    hasMore: true,
  },

  onLoad() {
    managedAllDishes = []
    managedSelectedIds = new Set()
    this.setData({
      loading: true,
      loadingMore: false,
      dishes: [],
      selectedCount: 0,
    })
  },

  async onShow() {
    this.setData({ loading: true })
    void this.loadData()
  },

  async loadData() {
    try {
      this.setData({ loading: true, loadingMore: false })
      const [dishes, categories] = await Promise.all([
        getDishesPage({
          limit: MANAGE_PAGE_SIZE,
          category: this.data.currentCategory,
          search: this.data.searchText,
        }),
        getCategories(),
      ])
      const catNames = categories.map((c) => c.name)
      const currentCategory = catNames.includes(this.data.currentCategory)
        ? this.data.currentCategory
        : '全部'
      managedAllDishes = await resolveDishImages(dishes)
      this.setData({
        dishes: [],
        categories: ['全部', ...catNames],
        currentCategory,
        hasMore: dishes.length === MANAGE_PAGE_SIZE,
      }, () => {
        this.filterDishes(managedAllDishes)
        this.setData({ loading: false })
        wx.hideLoading()
      })
    } catch (err) {
      console.error('加载失败:', err)
      this.setData({ loading: false })
      wx.hideLoading()
    }
  },

  async loadFirstPage() {
    try {
      this.setData({ loading: true, loadingMore: false, hasMore: true })
      const dishes = await getDishesPage({
        limit: MANAGE_PAGE_SIZE,
        category: this.data.currentCategory,
        search: this.data.searchText,
      })
      managedAllDishes = await resolveDishImages(dishes)
      this.setData({
        hasMore: dishes.length === MANAGE_PAGE_SIZE,
      }, () => {
        this.filterDishes(managedAllDishes)
        this.setData({ loading: false })
      })
    } catch (err) {
      console.error('加载失败:', err)
      this.setData({ loading: false })
    }
  },

  async loadMoreDishes() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    try {
      const dishes = await getDishesPage({
        skip: managedAllDishes.length,
        limit: MANAGE_PAGE_SIZE,
        category: this.data.currentCategory,
        search: this.data.searchText,
      })
      const resolved = await resolveDishImages(dishes)
      managedAllDishes = [...managedAllDishes, ...resolved]
      this.setData({
        hasMore: dishes.length === MANAGE_PAGE_SIZE,
      }, () => {
        this.filterDishes(managedAllDishes)
      })
    } catch (err) {
      console.error('加载更多失败:', err)
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  filterDishes(allDishes: Dish[]) {
    const enhanced = allDishes.map((d) => ({
      ...d,
      selected: managedSelectedIds.has(d._id!),
      starsText: '⭐'.repeat(d.stars),
    }))

    this.setData({ dishes: enhanced, selectedCount: managedSelectedIds.size })
  },

  onSearch(e: any) {
    this.setData({ searchText: e.detail.value })
    if (managedSearchTimer) clearTimeout(managedSearchTimer)
    managedSearchTimer = setTimeout(() => {
      void this.loadFirstPage()
    }, 300) as unknown as number
  },

  selectCategory(e: any) {
    this.setData({ currentCategory: e.currentTarget.dataset.cat }, () => {
      void this.loadFirstPage()
    })
  },

  toggleSelect(e: any) {
    const id = e.currentTarget.dataset.id
    if (managedSelectedIds.has(id)) {
      managedSelectedIds.delete(id)
    } else {
      managedSelectedIds.add(id)
    }
    this.filterDishes(managedAllDishes)
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
    const dishes = this.data.dishes.map((dish) =>
      dish._id === id ? { ...dish, displayImage: '' } : dish
    )
    this.setData({ dishes })
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
        await this.loadData()
      },
    })
  },

  async batchDelete() {
    if (managedSelectedIds.size === 0) return
    wx.showModal({
      title: '确认删除',
      content: '确定删除选中的 ' + managedSelectedIds.size + ' 道菜品吗？',
      success: async (res) => {
        if (!res.confirm) return
        const count = managedSelectedIds.size
        await batchDeleteDishes([...managedSelectedIds])
        managedSelectedIds = new Set()
        await this.loadData()
        this.showToast('已删除 ' + count + ' 道菜品')
      },
    })
  },

  openBatchCategory() {
    if (managedSelectedIds.size === 0) {
      this.showToast('请先选择菜品')
      return
    }
    this.setData({ showCategoryModal: true })
  },

  closeCategoryModal() {
    this.setData({ showCategoryModal: false })
  },

  async confirmBatchCategory(e: any) {
    const cat = e.currentTarget.dataset.cat
    const count = managedSelectedIds.size
    await batchUpdateCategory([...managedSelectedIds], cat)
    managedSelectedIds = new Set()
    this.setData({ showCategoryModal: false })
    await this.loadData()
    this.showToast('已修改 ' + count + ' 道菜的分类为「' + cat + '」')
  },

  goBack() {
    wx.navigateBack()
  },

  showToast(msg: string) {
    this.setData({ toastMsg: msg, toastShow: true })
    setTimeout(() => {
      this.setData({ toastShow: false })
    }, 1500)
  },

  onReachBottom() {
    void this.loadMoreDishes()
  },
})
