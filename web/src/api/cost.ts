/**
 * 上游进价与密钥余额核算接口。
 *
 * 意图（Why）：
 *   站长要回答"上游每个模型怎么收我的钱"与"这把密钥还剩多少"两个问题，
 *   它们的数据都挂在【渠道】之下（成本按渠道×模型，用量按渠道×密钥），
 *   因此收敛到这个文件，视图层不关心路径与字段转换。
 *
 * 流转（Flow）：
 *   渠道页「上游计费」→ listChannelCosts / saveChannelCosts
 *                     → /api/admin/channels/{id}/costs
 *   渠道页「密钥池」  → fetchChannelKeyUsage
 *                     → /api/admin/channels/{id}/key-usage
 *
 * 扩展（Extend）：
 *   新增核算维度时同步 types.ts 的 ChannelModelCost / ChannelKeyUsage 与后端 DTO。
 *   注意：路径不含 /api 前缀，前缀由 client.ts 的 baseURL 统一拼接。
 */
import { api } from './client'
import type {
  ChannelCostListResult,
  ChannelKeyUsageResult,
  ChannelModelCostPayload,
} from './types'

/** GET /api/admin/channels/{id}/costs：读取该渠道的上游进价规则 */
export function listChannelCosts(channelID: number): Promise<ChannelCostListResult> {
  return api.get<ChannelCostListResult>(`/admin/channels/${channelID}/costs`)
}

/**
 * PUT /api/admin/channels/{id}/costs：整体保存该渠道的上游进价。
 *
 * 语义是「替换」：调用后该渠道的规则恰好是提交的这一批，
 * 界面上删掉的行会真的被删除。传空数组表示清空该渠道的成本配置。
 */
export function saveChannelCosts(
  channelID: number,
  items: ChannelModelCostPayload[],
): Promise<{ ok: boolean; created: number; updated: number; total: number }> {
  return api.put(`/admin/channels/${channelID}/costs`, { items })
}

/** GET /api/admin/channels/{id}/key-usage：读取各密钥的用量、估算消耗与剩余 */
export function fetchChannelKeyUsage(channelID: number): Promise<ChannelKeyUsageResult> {
  return api.get<ChannelKeyUsageResult>(`/admin/channels/${channelID}/key-usage`)
}
