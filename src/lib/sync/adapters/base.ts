/**
 * 数据同步适配器基础接口
 * 用于统一不同数据源（Nike, Strava, Garmin）的数据格式
 */
export interface SyncAdapter {
  /** 适配器名称 */
  name: string

  /**
   * 认证
   * @param credentials 认证凭证
   * @returns 认证是否成功
   */
  authenticate: (credentials: Record<string, any>) => Promise<boolean>

  /**
   * 获取活动列表
   * @param options 查询选项
   * @returns 原始活动数据列表
   */
  getActivities: (options?: {
    startDate?: Date
    endDate?: Date
    /** Unix timestamp - only fetch activities after this time (for incremental sync) */
    after?: number
    /**
     * 按活动类型分别给的增量游标(键为 RawActivity.type,值为 unix 秒)。
     *
     * Reason: 一个数据源可能同时供多种运动(如 Keep 的跑步+骑行),而它们的最新时间
     * 各不相同。只用 source 级的单一 after,较新的那类会把游标推过较旧那类尚未入库的
     * 活动,造成永久漏数据。适配器优先用本字段,缺失时回落到 after。
     */
    afterByType?: Record<string, number>
    limit?: number
    /**
     * 拉取单条活动详情前的去重判断回调。返回 false 则跳过该活动(不发详情/streams 请求)。
     * 用于增量同步省请求:库里已存在的活动直接跳过。
     */
    shouldFetchDetail?: (sourceId: string) => boolean | Promise<boolean>
  }) => Promise<RawActivity[]>

  /**
   * 获取单个活动详情（包含 GPX 数据）
   * @param id 活动 ID
   * @returns 原始活动数据
   */
  getActivityDetail: (id: string) => Promise<RawActivity>

  /**
   * 下载 GPX 文件
   * @param activityId 活动 ID
   * @returns GPX XML 字符串
   */
  downloadGPX: (activityId: string) => Promise<string>

  /**
   * 健康检查
   * @returns 服务是否可用
   */
  healthCheck: () => Promise<boolean>
}

/**
 * 原始活动数据（统一格式）
 */
export interface RawActivity {
  /** 活动 ID */
  id: string
  /** 活动标题 */
  title: string
  /** 活动类型 */
  type: 'running' | 'cycling' | 'walking' | 'swimming' | 'other'
  /** 是否室内活动（跑步机等） */
  isIndoor?: boolean
  /** 开始时间 */
  startTime: Date
  /** 持续时间（秒） */
  duration: number
  /** 距离（米） */
  distance: number
  /** GPX 数据（可选） */
  gpxData?: string
  /** 平均配速（秒/公里）（可选） */
  averagePace?: number
  /** 最快配速（秒/公里）（可选） */
  bestPace?: number
  /** 海拔上升（米）（可选） */
  elevationGain?: number
  /** 平均心率（可选） */
  averageHeartRate?: number
  /** 最大心率（可选） */
  maxHeartRate?: number
  /** 卡路里（可选） */
  calories?: number
  /** 数据来源 */
  source: string
}

/**
 * 适配器工厂函数在 service.ts 的 createAdapter。
 * 现存适配器:KeepAdapter(默认源)、StravaAdapter(政策停用,保留待命)。
 */
