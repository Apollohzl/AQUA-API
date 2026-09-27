/**
 * 管理后台 · 渠道密钥池的「余额」扩展接口与局部类型。
 *
 * 意图（Why）：
 *   部分上游的密钥池是"每把密钥余额不同"的形态，站长需要在后台录入余额，
 *   并让余额耗尽的密钥自动退出调度。余额属于运营数据，只允许出现在管理接口，
 *   因此这里单独建一个 api 文件承载它，而不去改动共享的 types.ts
 *   （共享类型被大量页面引用，改它影响面太大）。
 *
 * 流转（Flow）：
 *   views/admin/ChannelsView.vue → 本文件 → GET /admin/channels/:id/keys
 *                                          → PUT /admin/keys/:keyId
 *
 * 扩展（Extend）：
 *   后端 channelKeyDTO 新增余额相关字段时，同步扩展本文件的 ChannelKeyWithBalance；
 *   balance 的语义固定为：-1=未录入，>=0=已知余额（0 表示已用尽）。
 */
import { api } from './client'
import type { ChannelKey, ChannelKeyQuota } from './types'

/**
 * 带余额字段的密钥。
 *
 * 在共享的 ChannelKey 之上，追加后端 channelKeyDTO 的余额相关字段：
 *   - balance：-1 表示未录入，>=0 为已知余额；
 *   - balance_unknown / balance_exhausted：由后端直接给出的派生布尔，
 *     前端不再自行实现"-1 表示未知"的规则（规则只在领域层维护一处）；
 *   - balance_updated_at：余额最近一次人工更新的 Unix 秒（0=未录入）。
 */
export interface ChannelKeyWithBalance extends ChannelKey {
  balance: number
  balance_unknown: boolean
  balance_exhausted: boolean
  balance_updated_at: number
  /**
   * 凭据原文，仅在 reveal=true 请求时返回。
   *
   * 默认不返回：一个渠道可能有几百把密钥，默认下发等于把整池明文
   * 灌进浏览器内存与前端日志。需要原文时由界面显式开启「显示明文」。
   */
  secret?: string
}

/** GET /api/admin/channels/{id}/keys 的响应 */
export interface ChannelKeyListResponse {
  items: ChannelKeyWithBalance[]
  total: number
  /** 本次响应是否包含凭据原文 */
  revealed?: boolean
}

/**
 * 读取某渠道的密钥池明细。
 *
 * 参数 reveal 为 true 时请求凭据原文（后端会为此写一条操作审计）。
 */
export function listChannelKeysWithBalance(
  channelId: number,
  reveal = false,
): Promise<ChannelKeyListResponse> {
  return api.get<ChannelKeyListResponse>(
    `/admin/channels/${channelId}/keys${reveal ? '?reveal=1' : ''}`,
  )
}

/**
 * POST /api/admin/channels/{id}/keys/{keyId}/quota
 *
 * 查询某个订阅账号（如 ChatGPT/Codex）的上游额度窗口并落库。
 *
 * 为什么按需触发而不是自动轮询：查询会对上游产生真实请求，
 * 而站长只在"怀疑某个账号快满了"时才需要它；
 * 落库后调度会自动跳过已用满的账号，所以一次查询足够用很久。
 */
export function probeChannelKeyQuota(
  channelId: number,
  keyId: number,
): Promise<ChannelKeyQuota> {
  return api.post<ChannelKeyQuota>(`/admin/channels/${channelId}/keys/${keyId}/quota`, {})
}

/**
 * PUT /api/admin/keys/{keyId} 的请求体（余额扩展版）。
 *
 * 保持与既有调用一致的部分更新语义：
 *   - 只传 balance：仅更新余额；
 *   - 传 status：启用 / 禁用 / 恢复；
 *   - 传 weight + priority + rpm_limit（三项须同时给）：更新调度参数。
 */
export interface UpdateChannelKeyBalancePayload {
  /** 余额：nil 不修改；-1 置为未录入；>=0 设为该值（0 = 已用尽） */
  balance?: number
  status?: number
  weight?: number
  priority?: number
  rpm_limit?: number
  /** 路由分叉（迁移 0038）：可服务的分组与模型；空数组 = 不限。两项需同时提供 */
  groups?: string[]
  models?: string[]
}

/**
 * PUT /api/admin/keys/{keyId}：更新单把密钥的余额（可选同时改状态/调度参数）。
 *
 * 与 admin.ts 的 updateChannelKey 打同一个后端接口，这里只是为了在类型上允许 balance。
 */
export function updateChannelKeyBalance(
  keyId: number,
  payload: UpdateChannelKeyBalancePayload,
): Promise<unknown> {
  return api.put<unknown>(`/admin/keys/${keyId}`, payload)
}
