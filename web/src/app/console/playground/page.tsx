/** 用户门户：游乐场（/console/playground）—— 在线试聊。
 *
 * 意图（Why）：
 *   用访问令牌直接调用 /v1/chat/completions，让用户在浏览器确认「令牌通不通、上游答不答得上」。
 *   令牌只粘贴一次、只存内存（不落 localStorage），避免明文泄漏风险。
 */
'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CodeBlock } from '@/components/ui/Display'
import { Field, Input, Select } from '@/components/ui/Form'
import { fetchModelPlaza } from '@/api/site'
import { useToast } from '@/lib/toast/toast-context'
import { getSessionToken } from '@/api/client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ConsolePlaygroundPage() {
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [token, setToken] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const { toastError } = useToast()

  // 预填本机会话令牌（用户可改），并加载模型名
  useEffect(() => {
    const session = getSessionToken()
    if (session) setToken(session)
    void fetchModelPlaza().then((data) => {
      const names = data.items.map((item) => item.model)
      setModels(names)
      if (names.length > 0) setModel(names[0])
    }).catch(() => setModels([]))
  }, [])

  async function handleSend() {
    if (!token.trim() || !model.trim() || !prompt.trim()) {
      toastError('请填写令牌、模型与问题')
      return
    }
    if (streaming) {
      abortRef.current?.abort()
      setStreaming(false)
      return
    }

    const userMsg: Message = { role: 'user', content: prompt }
    setMessages((prev) => [...prev, userMsg])
    setPrompt('')
    setError('')

    // 流式读取：SSE 逐块渲染（等价旧版 playLLM 逻辑）
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({
          model: model.trim(),
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        let message = `请求失败（HTTP ${response.status}）`
        try {
          const data = await response.json()
          message = data?.error?.message || message
        } catch {
          /* 保留默认提示 */
        }
        setError(message)
        setMessages((prev) => prev.slice(0, -1))
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') next[next.length - 1] = { role: 'assistant', content: last.content + delta }
                return next
              })
            }
          } catch {
            /* 忽略无法解析的块 */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // 用户主动停止：保留已生成内容
      } else {
        setError('请求出错了，请检查令牌是否有效')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">游乐场</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">在线试聊，先确认令牌能通再接入客户端</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Card className="flex flex-col">
          <div className="min-h-72 space-y-3">
            {messages.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-[13px] text-ink-3">
                在上方或下方输入问题开始对话
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user' ? 'bg-brand text-on-brand' : 'border border-line bg-surface text-ink-2'
                    }`}
                  >
                    {msg.content || (streaming && index === messages.length - 1 ? '正在生成…' : '')}
                  </div>
                </div>
              ))
            )}
            {error && <div className="rounded-md border border-err/25 bg-err/8 px-3 py-2 text-[13px] text-err">{error}</div>}
          </div>

          <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              rows={2}
              className="flex-1 rounded-md border border-line-2 bg-card px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <Button variant="primary" onClick={handleSend} className="shrink-0">
              {streaming ? '停止' : '发送'}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <Field label="访问令牌">
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-..." />
            </Field>
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.length === 0 && <option value="">加载中…</option>}
                {models.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
            </Field>
            <div className="text-xs leading-relaxed text-ink-3">
              令牌只保存在本页内存，刷新即消失。调用走 <code className="rounded bg-ink/5 px-1">/v1</code> 网关。
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}