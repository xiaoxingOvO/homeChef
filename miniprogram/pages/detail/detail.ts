// pages/detail/detail.ts
import { getToday, DEFAULT_EMOJIS } from '../../utils/util'
import { getDishById, getDishByName, updateDish, deleteDish, getCategories, saveMealPlan, getMealPlans, getUserSettings, addDish } from '../../utils/db'
import { getCachedDishImage, rememberDishImage, resolveDishImage } from '../../utils/image-cache'

Page({
  data: {
    dishId: '',
    dish: null as (Dish & { displayImage: string; starsText: string }) | null,

    // 编辑弹窗
    showEditModal: false,
    editingId: '',
    categories: [] as string[],
    customEmojis: DEFAULT_EMOJIS,
    editForm: {
      name: '',
      category: '',
      emoji: '🍛',
      stars: 3,
      image: '',
    } as Partial<Dish> & { stars: number },
    editPreviewImage: '',

    // 做法编辑
    showStepsModal: false,
    stepsText: '',

    // Toast
    toastShow: false,
    toastMsg: '',

    // 餐次选择
    showMealModal: false,
  },

  async onLoad(options: any) {
    if (options.id === 'new') {
      this.setData({
        dishId: '',
        editingId: '',
        categories: this.data.categories.length ? this.data.categories : ['荤菜', '素菜', '汤', '主食', '凉菜', '小吃', '其他'],
        customEmojis: this.data.customEmojis.length ? this.data.customEmojis : DEFAULT_EMOJIS,
        editForm: {
          name: '',
          category: this.data.categories[0] || '荤菜',
          emoji: '🍛',
          stars: 3,
          image: '',
        },
        showEditModal: true,
      })
      void this.loadEditOptions()
      return
    }

    if (options.id) {
      this.setData({ dishId: options.id })
      await this.loadDish()
    }
  },

  async onShow() {
    if (this.data.dishId) {
      void this.loadDish()
    }
  },

  async loadEditOptions() {
    try {
      const [categories, settings] = await Promise.all([
        getCategories(),
        getUserSettings(),
      ])
      const catNames = categories.map((category) => category.name)
      this.setData({
        categories: catNames,
        customEmojis: settings?.customEmojis || DEFAULT_EMOJIS,
        editForm: {
          ...this.data.editForm,
          category: this.data.editForm.category || catNames[0] || '',
        },
      })
    } catch (err) {
      console.error('加载编辑选项失败:', err)
    }
  },

  async loadDish() {
    try {
      const dish = await getDishById(this.data.dishId)
      if (dish) {
        // 菜谱页已经解析过的图片直接复用，避免进入详情页时再次等待下载。
        const cachedImage = getCachedDishImage(dish._id!, dish.image)
        const image = cachedImage || await resolveDishImage(dish.image)
        const enhanced = {
          ...dish,
          displayImage: image,
          starsText: '⭐'.repeat(dish.stars),
        }
        this.setData({ dish: enhanced })
      } else {
        this.setData({ dish: null })
      }
    } catch (err) {
      console.error('加载菜品失败:', err)
    }
  },

  goBack() {
    wx.navigateBack()
  },

  // ==================== 加入今日 ====================

  addToToday() {
    if (!this.data.dish) return
    this.setData({ showMealModal: true })
  },

  closeMealModal() {
    this.setData({ showMealModal: false })
  },

  async addToMeal(e: any) {
    if (!this.data.dish) return
    const mealKey = e.currentTarget.dataset.meal as keyof MealSlot
    const d = this.data.dish
    const today = getToday()
    const nameWithEmoji = d.emoji + ' ' + d.name

    const existing = await getMealPlans([today])
    const meals: MealSlot = existing[0]?.meals || {
      breakfast: [],
      lunch: [],
      dinner: [],
    }

    if (!meals[mealKey].includes(nameWithEmoji)) {
      meals[mealKey].push(nameWithEmoji)
    }

    await saveMealPlan({ date: today, meals })
    this.setData({ showMealModal: false })
    const mealLabel = mealKey === 'breakfast' ? '早餐' : mealKey === 'lunch' ? '午餐' : '晚餐'
    this.showToast('已加入今日' + mealLabel)
  },

  // ==================== 编辑菜品 ====================

  async openEditDish() {
    const d = this.data.dish
    if (!d) return

    this.setData({
      editingId: d._id!,
      editForm: {
        name: d.name,
        category: d.category,
        emoji: d.emoji,
        stars: d.stars,
        image: d.image || '',
      },
      editPreviewImage: d.displayImage || d.image || '',
      showEditModal: true,
    })
    void this.loadEditOptions()
    if (!d.displayImage && d.image) {
      const image = await resolveDishImage(d.image)
      this.setData({ editPreviewImage: image })
    }
  },

  onFormChange(e: any) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    const editForm = { ...this.data.editForm, [field]: value }
    this.setData({ editForm })
  },

  chooseDishImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const originalPath = res.tempFilePaths[0]
        if (!originalPath) return

        wx.showLoading({ title: '上传中' })
        try {
          // 再压缩一次，避免手机原图过大占用云存储和流量
          const compressed = await wx.compressImage({
            src: originalPath,
            quality: 75,
          })
          const filePath = compressed.tempFilePath || originalPath
          const extension = filePath.split('.').pop() || 'jpg'
          const cloudPath = 'dishes/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extension
          const uploadResult = await wx.cloud.uploadFile({ cloudPath, filePath })
          const displayImage = await rememberDishImage(uploadResult.fileID, filePath)
          this.setData({
            editForm: { ...this.data.editForm, image: uploadResult.fileID },
            editPreviewImage: displayImage,
          })
          this.showToast('图片已上传')
        } catch (err) {
          console.error('上传图片失败:', err)
          this.showToast('图片上传失败')
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  clearDishImage() {
    this.setData({
      editForm: { ...this.data.editForm, image: '' },
      editPreviewImage: '',
    })
  },

  onCoverImageError() {
    if (!this.data.dish) return
    this.setData({ dish: { ...this.data.dish, displayImage: '' } })
  },

  onPreviewImageError() {
    this.setData({ editPreviewImage: '' })
  },

  selectEditCategory(e: any) {
    const category = e.currentTarget.dataset.category
    this.setData({ editForm: { ...this.data.editForm, category } })
  },

  setStars(e: any) {
    const stars = e.currentTarget.dataset.stars
    this.setData({ editForm: { ...this.data.editForm, stars } })
  },

  pickEmoji(e: any) {
    const emoji = e.currentTarget.dataset.emoji
    this.setData({ editForm: { ...this.data.editForm, emoji } })
  },

  closeEditModal() {
    this.setData({ showEditModal: false })
  },

  async confirmEdit() {
    const { editingId, editForm } = this.data
    if (!editForm.name?.trim()) {
      this.showToast('请输入名称')
      return
    }

    // 检查重名
    const dup = await getDishByName(editForm.name)
    if (dup && dup._id === editingId) {
      // 当前菜品本身，不算重名。
    } else if (dup) {
      this.showToast('已存在同名菜品')
      return
    }

    try {
      if (editingId) {
        await updateDish(editingId, {
          name: editForm.name!,
          category: editForm.category!,
          emoji: editForm.emoji!,
          stars: editForm.stars!,
          image: editForm.image || '',
        })
      } else {
        // 新增
        const id = await addDish({
          name: editForm.name!,
          category: editForm.category!,
          emoji: editForm.emoji!,
          stars: editForm.stars!,
          count: 0,
          image: editForm.image || '',
          steps: ['做法待补充'],
          note: '',
        })
        this.setData({ dishId: id })
      }

      this.setData({ showEditModal: false })
      await this.loadDish()
      this.showToast(editingId ? '已更新' : '已添加')
    } catch (err) {
      console.error('保存失败:', err)
      this.showToast('保存失败')
    }
  },

  // ==================== 编辑做法 ====================

  openEditSteps() {
    const d = this.data.dish
    if (!d) return
    this.setData({
      stepsText: (d.steps || []).join('\n'),
      showStepsModal: true,
    })
  },

  onStepsChange(e: any) {
    this.setData({ stepsText: e.detail.value })
  },

  closeStepsModal() {
    this.setData({ showStepsModal: false })
  },

  async confirmSteps() {
    const steps = this.data.stepsText
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => s)
    await updateDish(this.data.dishId, { steps })
    this.setData({ showStepsModal: false })
    await this.loadDish()
    this.showToast('做法已更新')
  },

  // ==================== 删除 ====================

  deleteDish() {
    if (!this.data.dish) return
    wx.showModal({
      title: '确认删除',
      content: '确定删除「' + this.data.dish.name + '」吗？此操作不可撤销。',
      success: async (res) => {
        if (!res.confirm) return
        await deleteDish(this.data.dishId)
        this.showToast('已删除')
        setTimeout(() => wx.navigateBack(), 500)
      },
    })
  },

  // ==================== Toast ====================

  showToast(msg: string) {
    this.setData({ toastMsg: msg, toastShow: true })
    setTimeout(() => {
      this.setData({ toastShow: false })
    }, 1500)
  },

  noop() {},
})
