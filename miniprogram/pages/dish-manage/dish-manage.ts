// pages/dish-manage/dish-manage.ts
import { getDishes, getCategories, deleteDish, batchDeleteDishes, batchUpdateCategory } from '../../utils/db'
import { resolveDishImages } from '../../utils/image-cache'

let managedSelectedIds = new Set<string>()
let managedAllDishes: Array<Dish & { displayImage: string }> = []

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
      managedAllDishes = await resolveDishImages(dishes)
      this.setData({
        categories: ['全部', ...catNames],
        currentCategory,
      }, () => {
        this.filterDishes(managedAllDishes)
      })
    } catch (err) {
      console.error('加载失败:', err)
    }
  },

  filterDishes(allDishes: Dish[]) {
    const { searchText, currentCategory } = this.data

    let filtered = allDishes
    if (currentCategory !== '全部') {
      filtered = filtered.filter((d) => d.category === currentCategory)
    }
    if (searchText) {
      filtered = filtered.filter((d) => d.name.includes(searchText.toLowerCase()))
    }

    const enhanced = filtered.map((d) => ({
      ...d,
      selected: managedSelectedIds.has(d._id!),
      starsText: '⭐'.repeat(d.stars),
    }))

    this.setData({ dishes: enhanced, selectedCount: managedSelectedIds.size })
  },

  onSearch(e: any) {
    this.setData({ searchText: e.detail.value }, () => {
      this.filterDishes(managedAllDishes)
    })
  },

  selectCategory(e: any) {
    this.setData({ currentCategory: e.currentTarget.dataset.cat }, () => {
      this.filterDishes(managedAllDishes)
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
})
