/**
 * 敏感词（内容合规过滤）接口。
 *
 * 意图（Why）：
 *   内容合规过滤由两块配置组成，二者缺一不可，因此放在同一个域文件里：
 *     1) 总开关（在系统设置的 safeguard 里，见 updateSettings）；
 *     2) 词表（本文件的下述接口）。
 *   视图层（SensitiveWordsView）只调用这些函数，不关心路径与字段名。
 *
 * 流转（Flow）：
 *   SensitiveWordsView → listSensitiveWords / createSensitiveWord / importSensitiveWords
 *                       / updateSensitiveWord / deleteSensitiveWord
 *                       → /api/admin/sensitive-words[...]
 *   总开关 → updateSettings({ safeguard: { sensitive_filter_enabled } })
 *
 * 扩展（Extend）：
 *   新增词条属性时同步 types.ts 的 SensitiveWord 与后端 DTO。
 *   注意：路径不含 /api 前缀，前缀由 client.ts 的 baseURL 统一拼接。
 */
import { api } from './client'
import type {
  SensitiveWord,
  SensitiveWordImportResult,
  SensitiveWordListResult,
  SensitiveWordPayload,
} from './types'

/** GET /api/admin/sensitive-words：读取全部词条 */
export function listSensitiveWords(): Promise<SensitiveWordListResult> {
  return api.get<SensitiveWordListResult>('/admin/sensitive-words')
}

/** POST /api/admin/sensitive-words：新增单条词条 */
export function createSensitiveWord(payload: SensitiveWordPayload): Promise<SensitiveWord> {
  return api.post<SensitiveWord>('/admin/sensitive-words', payload)
}

/**
 * POST /api/admin/sensitive-words/import：批量导入。
 *
 * 文本由后端按换行/逗号/顿号等常见分隔符切分，前端无需预处理；
 * 已存在的词条会被跳过（不报错），返回值里给出实际新增条数。
 */
export function importSensitiveWords(text: string, category = ''): Promise<SensitiveWordImportResult> {
  return api.post<SensitiveWordImportResult>('/admin/sensitive-words/import', { text, category })
}

/** PUT /api/admin/sensitive-words/{id}：更新词条（只需提交要改的字段） */
export function updateSensitiveWord(id: number, payload: SensitiveWordPayload): Promise<SensitiveWord> {
  return api.put<SensitiveWord>(`/admin/sensitive-words/${id}`, payload)
}

/** DELETE /api/admin/sensitive-words/{id}：删除词条 */
export function deleteSensitiveWord(id: number): Promise<unknown> {
  return api.delete<unknown>(`/admin/sensitive-words/${id}`)
}
