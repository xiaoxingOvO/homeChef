// pages/emoji-manage/emoji-manage.ts
import { DEFAULT_EMOJIS, RECOMMENDED_EMOJIS, getEmojiDesc } from '../../utils/util'
import { getUserSettings, saveUserSettings } from '../../utils/db'

Page({
  data: {
    customEmojis: DEFAULT_EMOJIS,
    searchText: '',
    filteredRecommended: [] as string[],

    showAddModal: false,
    newEmoji: '',

    toastShow: false,
    toastMsg: '',
  },

  async onShow() {
    this.setData({ customEmojis: [], filteredRecommended: [] })
    void this.loadData()
  },

  async loadData() {
    try {
      const settings = await getUserSettings()
      const customEmojis = settings?.customEmojis?.length
        ? settings.customEmojis
        : DEFAULT_EMOJIS
      this.setData({ customEmojis })
      this.filterRecommended()
      wx.hideLoading()
    } catch (err) {
      console.error('加载图标失败:', err)
      this.filterRecommended()
      wx.hideLoading()
    }
  },

  filterRecommended() {
    const { customEmojis, searchText } = this.data
    const mySet = new Set(customEmojis)

    let list = RECOMMENDED_EMOJIS.filter((e) => {
      if (mySet.has(e)) return false
      if (searchText) {
        const desc = getEmojiDesc(e)
        return desc.includes(searchText.toLowerCase()) || e.includes(searchText)
      }
      return true
    })

    this.setData({ filteredRecommended: list })
  },

  onSearch(e: any) {
    this.setData({ searchText: e.detail.value })
    this.filterRecommended()
  },

  async saveCustomEmojis() {
    await saveUserSettings({ customEmojis: this.data.customEmojis })
  },

  async addEmoji(e: any) {
    const emoji = e.currentTarget.dataset.emoji
    if (this.data.customEmojis.includes(emoji)) {
      this.showToast('该图标已在「我的图标」中')
      return
    }
    const customEmojis = [...this.data.customEmojis, emoji]
    this.setData({ customEmojis })
    await this.saveCustomEmojis()
    this.filterRecommended()
    this.showToast('已添加 ' + emoji + ' 到「我的图标」')
  },

  async removeEmoji(e: any) {
    const emoji = e.currentTarget.dataset.emoji
    if (this.data.customEmojis.length <= 4) {
      this.showToast('至少保留4个图标')
      return
    }

    wx.showModal({
      title: '移除图标',
      content: '确定从「我的图标」中移除 ' + emoji + ' 吗？移除后仍可在推荐图标库中找回。',
      success: async (res) => {
        if (!res.confirm) return
        const customEmojis = this.data.customEmojis.filter((e: string) => e !== emoji)
        this.setData({ customEmojis })
        await this.saveCustomEmojis()
        this.filterRecommended()
        this.showToast('已移除图标 ' + emoji)
      },
    })
  },

  openAddEmoji() {
    this.setData({ showAddModal: true, newEmoji: '' })
  },

  closeAddModal() {
    this.setData({ showAddModal: false })
  },

  onEmojiInput(e: any) {
    this.setData({ newEmoji: e.detail.value })
  },

  async confirmAddEmoji() {
    const emoji = this.data.newEmoji.trim()
    if (!emoji) {
      this.showToast('请输入图标')
      return
    }
    if (this.data.customEmojis.includes(emoji)) {
      this.showToast('该图标已在「我的图标」中')
      return
    }
    const customEmojis = [...this.data.customEmojis, emoji]
    this.setData({ customEmojis, showAddModal: false })
    await this.saveCustomEmojis()
    this.filterRecommended()
    this.showToast('已添加图标 ' + emoji)
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
