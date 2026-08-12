// pages/category-manage/category-manage.ts
import {
  getCategories, addCategory, deleteCategory, getDishes, updateDish,
  updateCategoryName, updateCategoryOrders,
} from '../../utils/db'

Page({
  addingInProgress: false,
  dragItemRects: [] as Array<{ top: number; bottom: number }>,
  dragStartClientY: 0,
  dragTargetIndex: -1,

  data: {
    categories: [] as Category[],
    showAddModal: false,
    newCatName: '',
    adding: false,
    showEditModal: false,
    editingCatId: '',
    editingCatOldName: '',
    editingCatName: '',
    reordering: false,
    dragActive: false,
    draggingIndex: -1,
    dragTranslateY: 0,

    toastShow: false,
    toastMsg: '',
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    try {
      const categories = await getCategories()
      this.setData({ categories })
    } catch (err) {
      console.error('加载分类失败:', err)
    }
  },

  openAdd() {
    this.setData({ showAddModal: true, newCatName: '' })
  },

  closeAdd() {
    this.setData({ showAddModal: false })
  },

  onNameInput(e: any) {
    this.setData({ newCatName: e.detail.value })
  },

  async confirmAdd() {
    // setData 是异步的，使用实例锁拦截同一时刻的重复点击。
    if (this.addingInProgress) return

    const name = this.data.newCatName.trim()
    if (!name) {
      this.showToast('请输入名称')
      return
    }
    this.addingInProgress = true
    this.setData({ adding: true })
    try {
      // 写入前重新读取云端，避免页面旧数据和连续点击造成重名。
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
      this.setData({ showAddModal: false, newCatName: '' })
      await this.loadData()
      this.showToast('已添加分类「' + name + '」')
    } catch (err) {
      console.error('新增分类失败:', err)
      this.showToast('新增失败')
    } finally {
      this.addingInProgress = false
      this.setData({ adding: false })
    }
  },

  openEdit(e: any) {
    const { id, name, system } = e.currentTarget.dataset
    if (system) return

    this.setData({
      showEditModal: true,
      editingCatId: id,
      editingCatOldName: name,
      editingCatName: name,
    })
  },

  closeEdit() {
    this.setData({ showEditModal: false })
  },

  onEditNameInput(e: any) {
    this.setData({ editingCatName: e.detail.value })
  },

  async confirmEdit() {
    const { editingCatId, editingCatOldName } = this.data
    const name = this.data.editingCatName.trim()
    if (!name) {
      this.showToast('请输入名称')
      return
    }
    if (name === editingCatOldName) {
      this.setData({ showEditModal: false })
      return
    }

    try {
      const latestCategories = await getCategories()
      const duplicate = latestCategories.some(
        (category) => category._id !== editingCatId && category.name === name
      )
      if (duplicate) {
        this.showToast('分类名称已存在')
        return
      }

      const dishes = await getDishes()
      const affectedDishes = dishes.filter(
        (dish) => dish.category === editingCatOldName
      )

      await updateCategoryName(editingCatId, name)
      await Promise.all(
        affectedDishes.map((dish) => updateDish(dish._id!, { category: name }))
      )

      this.setData({ showEditModal: false })
      await this.loadData()
      this.showToast('分类名称已更新')
    } catch (err) {
      console.error('修改分类名称失败:', err)
      this.showToast('修改失败')
    }
  },

  onDragStart(e: any) {
    if (this.data.reordering) return

    const index = Number(e.currentTarget.dataset.index)
    const clientY = e.touches?.[0]?.clientY
    this.dragStartClientY = typeof clientY === 'number' ? clientY : 0
    this.dragTargetIndex = index
    this.setData({
      dragActive: true,
      draggingIndex: index,
      dragTranslateY: 0,
    })
    this.createSelectorQuery()
      .selectAll('.category-item')
      .boundingClientRect((rects: any[]) => {
        if (!this.data.dragActive || !rects?.length) return
        this.dragItemRects = rects.map((rect) => ({
          top: rect.top,
          bottom: rect.bottom,
        }))
        if (!this.dragStartClientY && this.dragItemRects[index]) {
          const rect = this.dragItemRects[index]
          this.dragStartClientY = (rect.top + rect.bottom) / 2
        }
      })
      .exec()
    wx.vibrateShort({ type: 'light' })
  },

  onDragMove(e: any) {
    if (!this.data.dragActive || this.data.reordering) return

    const clientY = e.touches?.[0]?.clientY
    if (typeof clientY !== 'number' || this.dragItemRects.length === 0) return

    let targetIndex = this.dragItemRects.findIndex(
      (rect) => clientY < (rect.top + rect.bottom) / 2
    )
    if (targetIndex === -1) targetIndex = this.dragItemRects.length - 1
    this.dragTargetIndex = targetIndex
    this.setData({ dragTranslateY: clientY - this.dragStartClientY })
  },

  async onDragEnd() {
    if (!this.data.dragActive || this.data.reordering) return

    const categories = [...this.data.categories]
    const fromIndex = this.data.draggingIndex
    const targetIndex = this.dragTargetIndex
    if (fromIndex >= 0 && targetIndex >= 0 && fromIndex !== targetIndex) {
      const [moved] = categories.splice(fromIndex, 1)
      categories.splice(targetIndex, 0, moved)
    }

    this.dragItemRects = []
    this.dragStartClientY = 0
    this.dragTargetIndex = -1
    this.setData({
      categories,
      dragActive: false,
      draggingIndex: -1,
      dragTranslateY: 0,
      reordering: true,
    })
    try {
      await updateCategoryOrders(categories)
      this.showToast('顺序已保存')
    } catch (err) {
      console.error('保存分类顺序失败:', err)
      await this.loadData()
      this.showToast('顺序保存失败')
    } finally {
      this.setData({ reordering: false })
    }
  },

  async deleteCat(e: any) {
    const { id, name, system } = e.currentTarget.dataset
    if (system) return

    wx.showModal({
      title: '确认删除',
      content: '确定删除分类「' + name + '」吗？该分类下的菜品将自动归入「其他」。',
      success: async (res) => {
        if (!res.confirm) return

        // 将该分类下的菜品移到"其他"
        const dishes = await getDishes()
        const toUpdate = dishes.filter((d) => d.category === name)
        for (const d of toUpdate) {
          await updateDish(d._id!, { category: '其他' })
        }

        await deleteCategory(id)
        const categories = await getCategories()
        await updateCategoryOrders(categories)
        this.setData({ categories })
        this.showToast('已删除「' + name + '」，菜品已归入「其他」')
      },
    })
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

  noop() {},
})
