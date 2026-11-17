// frontend/src/pages/reports/ChatPanel.tsx
// ==================================================================
// شات التقارير (مساعد Gemini) → POST /reports/chat
//   body: { message, messages (السجل), includeContext (افتراضي true), serverId? }
//   رد:   data.reply (+ model, tokensUsed)
// قيود الباك: الرسالة ≤ 4000 حرف • السجل ≤ 40 رسالة (~48 ألف حرف)
// includeContext=true: الباك بيبعت إحصائيات آخر 7 أيام لـ Gemini (من غير Origin IP أو أسرار).
// مفتاح Gemini موجود في الباك بس، والفرونت مابيبعتش أي مفتاح.
// ==================================================================

import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Sparkles, Trash2, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../../components/ui/Toast'
import { Button, Card, SelectInput, Toggle } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { chatWithReports, type ChatMessage } from '../../services/reportsService'
import type { Server } from '../../services/serversService'
import { cn } from '../../utils/format'
import Markdown from './Markdown'

const MAX_MESSAGE = 4000 // CHAT_MAX_MESSAGE_LENGTH
const MAX_HISTORY = 40 // CHAT_MAX_HISTORY_MESSAGES
const MAX_HISTORY_CHARS = 48_000 // CHAT_MAX_HISTORY_CHARS

/** بنقص السجل من الأقدم عشان نفضل جوه حدود الباك */
function trimHistory(history: ChatMessage[]): ChatMessage[] {
  let out = history.slice(-MAX_HISTORY)
  let chars = out.reduce((n, m) => n + m.content.length, 0)
  while (chars > MAX_HISTORY_CHARS && out.length > 0) {
    chars -= out[0]?.content.length ?? 0
    out = out.slice(1)
  }
  return out
}

export default function ChatPanel({ servers }: { servers: Server[] }) {
  const { t } = useTranslation(['reports', 'common'])
  const toast = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [serverId, setServerId] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const SUGGESTIONS = [
    t('reports:chat.suggestions.weekly', 'Summarize the attacks I faced this week'),
    t('reports:chat.suggestions.paths', 'Which paths are targeted the most?'),
    t('reports:chat.suggestions.policies', 'What policy changes do you recommend?'),
  ]

  // سكرول لآخر رسالة
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || sending) return
    if (message.length > MAX_MESSAGE) {
      setError(t('reports:validation.messageTooLong', { max: MAX_MESSAGE }))
      return
    }

    setError(null)
    setInput('')
    const history = trimHistory(messages)
    setMessages((m) => [...m, { role: 'user', content: message }])
    setSending(true)

    try {
      const res = await chatWithReports({
        message,
        messages: history,
        includeContext,
        ...(serverId && { serverId }),
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
    } catch (err) {
      const parsed = parseApiError(err)
      setError(parsed.message)
      toast.error(t('reports:toast.chatFailed', 'The assistant could not answer'), parsed.message)
      // بنرجّع رسالة المستخدم في الـ input عشان يعيد المحاولة من غير ما يكتبها تاني
      setMessages((m) => m.slice(0, -1))
      setInput(message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="flex h-[640px] flex-col overflow-hidden" accent>
      {/* ---------- الإعدادات ---------- */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/6 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">{t('reports:chat.title', 'Security assistant')}</p>
            <p className="text-[11px] text-slate-500">{t('reports:chat.subtitle', 'Ask about your traffic, attacks and policies')}</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <SelectInput value={serverId} onChange={(e) => setServerId(e.target.value)} className="w-40 py-1.5 text-xs">
            <option value="">{t('reports:page.allServers', 'All servers')}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1224]">{s.domain}</option>
            ))}
          </SelectInput>
          <label className="flex items-center gap-2 text-xs text-slate-400" title={t('reports:chat.useMyDataTip', 'Send 7-day statistics to the assistant (no origin IPs or secrets)')}>
            {t('reports:chat.useMyData', 'Use my data')}
            <Toggle checked={includeContext} onChange={setIncludeContext} label={t('reports:chat.includeContext', 'Include context')} />
          </label>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { setMessages([]); setError(null) }}>
              {t('reports:chat.clear', 'Clear')}
            </Button>
          )}
        </div>
      </div>

      {/* ---------- الرسائل ---------- */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="zp-anim-pulse-ring flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Bot className="h-7 w-7" />
            </span>
            <p className="mt-4 text-base font-semibold text-white">{t('reports:chat.welcomeTitle', 'How can I help?')}</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">{t('reports:chat.welcomeDesc', 'Pick a question or write your own.')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-xl border border-white/10 bg-white/3 px-3.5 py-2 text-xs text-slate-300 hover:border-cyan-400/30 hover:text-cyan-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn('zp-anim-fade-up flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                m.role === 'user' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-cyan-500/10 text-cyan-300')}>
                {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </span>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5',
                m.role === 'user' ? 'bg-indigo-500/12 text-sm text-slate-100' : 'border border-white/8 bg-white/3')}>
                {m.role === 'user' ? <p dir="auto" className="whitespace-pre-wrap text-sm">{m.content}</p> : <Markdown source={m.content} />}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300"><Bot className="h-4 w-4" /></span>
            <div className="flex gap-1.5 rounded-2xl border border-white/8 bg-white/3 px-4 py-3">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ---------- الإدخال ---------- */}
      <div className="border-t border-white/6 p-4">
        {error && <p dir="auto" className="mb-2 text-xs text-rose-400">{error}</p>}
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            rows={1}
            maxLength={MAX_MESSAGE}
            disabled={sending}
            dir="auto"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter = إرسال، Shift+Enter = سطر جديد
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            placeholder={t('reports:chat.inputPlaceholder', 'Ask anything about your traffic, attacks, IPs or policies…')}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-white/3 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
          />
          <Button variant="primary" icon={Send} loading={sending} disabled={!input.trim()} onClick={() => void send(input)}>
            {t('reports:chat.send', 'Send')}
          </Button>
        </div>
        <p className="mt-1.5 text-right text-[11px] text-slate-600">{input.length}/{MAX_MESSAGE}</p>
      </div>
    </Card>
  )
}
