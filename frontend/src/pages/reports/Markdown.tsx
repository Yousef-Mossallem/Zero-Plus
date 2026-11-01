// frontend/src/pages/reports/Markdown.tsx
// ==================================================================
// عارض Markdown آمن لمحتوى التقارير والشات.
// مفيش dangerouslySetInnerHTML ولا مكتبة خارجية: بنبني عناصر React بس،
// فأي HTML داخل النص بيتعرض كنص عادي (ممنوع ينفّذ).
// مدعوم: عناوين • قوائم • اقتباس • كود • جداول • **bold** *italic* `code` • روابط http/https فقط
// ==================================================================

import { Fragment, type ReactNode } from 'react'

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={key} className="font-semibold text-white">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={key} className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-200">{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={key}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link)
      return (
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">
          {link[1]}
        </a>
      )
    return <Fragment key={key}>{part}</Fragment>
  })
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const key = `b${k++}`

    // ---- code fence ----
    if (line.trim().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) buf.push(lines[i++] ?? '')
      i++
      out.push(
        <pre key={key} dir="ltr" className="my-3 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-4 text-xs leading-relaxed text-slate-300">
          {buf.join('\n')}
        </pre>,
      )
      continue
    }
    // ---- heading ----
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = (h[1] ?? '#').length
      const cls = ['text-xl', 'text-lg', 'text-base', 'text-sm'][level - 1] ?? 'text-base'
      out.push(
        <p key={key} dir="auto" className={`mb-2 mt-5 font-bold text-white ${cls}`}>
          {inline(h[2] ?? '', key)}
        </p>,
      )
      i++
      continue
    }
    // ---- hr ----
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key} className="my-4 border-white/8" />)
      i++
      continue
    }
    // ---- table ----
    if (line.includes('|') && isTableSep(lines[i + 1] ?? '')) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') rows.push(cells(lines[i++] ?? ''))
      out.push(
        <div key={key} className="my-3 overflow-x-auto rounded-xl border border-white/8">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/4 text-slate-400">
              <tr>{head.map((c, ci) => <th key={ci} className="px-3 py-2 font-semibold">{inline(c, `${key}h${ci}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-white/5">
                  {r.map((c, ci) => <td key={ci} className="px-3 py-2 text-slate-300">{inline(c, `${key}r${ri}c${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    // ---- lists ----
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? '')) {
        items.push((lines[i++] ?? '').replace(/^\s*([-*+]|\d+\.)\s+/, ''))
      }
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={key} className={`my-2 space-y-1 ps-5 text-sm text-slate-300 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, ii) => <li key={ii} dir="auto">{inline(it, `${key}i${ii}`)}</li>)}
        </Tag>,
      )
      continue
    }
    // ---- quote ----
    if (line.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) buf.push((lines[i++] ?? '').replace(/^>\s?/, ''))
      out.push(
        <blockquote key={key} dir="auto" className="my-3 border-s-2 border-cyan-400/40 bg-cyan-500/5 px-4 py-2 text-sm text-slate-300">
          {inline(buf.join(' '), key)}
        </blockquote>,
      )
      continue
    }
    // ---- blank ----
    if (line.trim() === '') {
      i++
      continue
    }
    // ---- paragraph ----
    const buf: string[] = []
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i] ?? '')) buf.push(lines[i++] ?? '')
    out.push(
      <p key={key} dir="auto" className="my-2 text-sm leading-relaxed text-slate-300">
        {inline(buf.join(' '), key)}
      </p>,
    )
  }

  return <div className="zp-anim-fade-in">{out}</div>
}
