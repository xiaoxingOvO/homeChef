// app.ts
const OPENID_CACHE_KEY = 'dailyMenuOpenid'
const SEED_READY_CACHE_PREFIX = 'dailyMenuSeedReady:'

App<IAppOption>({
  globalData: {
    openid: '',
    cloudEnvId: 'cloud1-d4g2275j3b7f31ddd',
    readyPromise: Promise.resolve(),
    openTodayEditRequested: false,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: this.globalData.cloudEnvId,
      traceUser: true,
    })

    const cachedOpenid = wx.getStorageSync(OPENID_CACHE_KEY)
    if (cachedOpenid) {
      this.globalData.openid = cachedOpenid
    }

    this.globalData.readyPromise = this.initializeApp()
  },

  async initializeApp() {
    try {
      const cachedOpenid = this.globalData.openid
      const seedReadyKey = cachedOpenid
        ? SEED_READY_CACHE_PREFIX + cachedOpenid
        : ''
      const seedReady = !!seedReadyKey && wx.getStorageSync(seedReadyKey) === true
      const tasks: Promise<any>[] = []

      if (!this.globalData.openid) {
        tasks.push(this.getOpenId())
      }
      if (!seedReady) {
        tasks.push(wx.cloud.callFunction({ name: 'seedData' }))
      }

      await Promise.all(tasks)
      const openid = this.globalData.openid
      if (!seedReady && openid) {
        wx.setStorageSync(SEED_READY_CACHE_PREFIX + openid, true)
      }
    } catch (err) {
      // 初始化失败不阻塞小程序打开，页面仍可显示错误或在下次启动重试。
      console.error('初始化用户数据失败:', err)
    }
  },

  async getOpenId() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOpenId',
      })
      this.globalData.openid = (res.result as any).openid
      wx.setStorageSync(OPENID_CACHE_KEY, this.globalData.openid)
      console.log('openid 获取成功:', this.globalData.openid)
    } catch (err) {
      console.error('获取 openid 失败:', err)
    }
  },
})
