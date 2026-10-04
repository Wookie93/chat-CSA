"use client"

import React, { useEffect, useState } from "react"
import Markdown, { type Components, type ExtraProps } from "react-markdown"
import type { ThemedToken } from "shiki"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"

interface MarkdownRendererProps {
  children: string
}

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <div className="space-y-3">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  )
}

interface HighlightedPre extends React.HTMLAttributes<HTMLPreElement> {
  children: string
  language: string
}

const HighlightedPre = React.memo(
  function HighlightedCode({ children, language, ...props }: HighlightedPre) {
    const [highlight, setHighlight] = useState<{
      code: string; language: string; tokens: ThemedToken[][]
    } | null>(null)

    useEffect(() => {
      let cancelled = false
      async function highlightCode() {
        try {
          const { codeToTokens, bundledLanguages } = await import("shiki")
          if (!(language in bundledLanguages)) return
          const { tokens } = await codeToTokens(children, {
            lang: language as keyof typeof bundledLanguages,
            theme: "github-light",
          })
          if (!cancelled) setHighlight({ code: children, language, tokens })
        } catch {
          // Plain text remains readable if a grammar cannot be loaded.
        }
      }
      void highlightCode()
      return () => { cancelled = true }
    }, [children, language])

    const tokens = highlight?.code === children && highlight.language === language
      ? highlight.tokens : null
    return (
      <pre {...props}><code>
        {tokens ? tokens.map((line, lineIndex) => (
          <React.Fragment key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={{ color: token.color }}>{token.content}</span>
            ))}
            {lineIndex !== tokens.length - 1 && "\n"}
          </React.Fragment>
        )) : children}
      </code></pre>
    )
  }
)

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children: React.ReactNode
  className?: string
  language: string
}

const CodeBlock = ({
  children,
  className,
  language,
  ...restProps
}: CodeBlockProps) => {
  const code =
    typeof children === "string"
      ? children
      : childrenTakeAllStringContents(children)

  const preClass = cn(
    "overflow-x-scroll rounded-md border bg-background/50 p-4 font-mono text-sm [scrollbar-width:none]",
    className
  )

  return (
    <div className="group/code relative mb-4">
      <HighlightedPre language={language} className={preClass} {...restProps}>
        {code}
      </HighlightedPre>

      <div className="invisible absolute right-2 top-2 flex space-x-1 rounded-lg p-1 opacity-0 transition-all duration-200 group-hover/code:visible group-hover/code:opacity-100">
        <CopyButton content={code} copyMessage="Copied code to clipboard" />
      </div>
    </div>
  )
}

function childrenTakeAllStringContents(element: React.ReactNode): string {
  if (typeof element === "string" || typeof element === "number") return String(element)
  if (Array.isArray(element)) return element.map(childrenTakeAllStringContents).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(element)) {
    return childrenTakeAllStringContents(element.props.children)
  }
  return ""
}

const COMPONENTS: Components = {
  h1: withClass("h1", "text-2xl font-semibold"),
  h2: withClass("h2", "font-semibold text-xl"),
  h3: withClass("h3", "font-semibold text-lg"),
  h4: withClass("h4", "font-semibold text-base"),
  h5: withClass("h5", "font-medium"),
  strong: withClass("strong", "font-semibold"),
  a: withClass("a", "text-primary underline underline-offset-2"),
  blockquote: withClass("blockquote", "border-l-2 border-primary pl-4"),
  code: ({ children, className }) => {
    const match = /language-(\w+)/.exec(className || "")
    return match ? (
      <CodeBlock className={className} language={match[1]}>
        {children}
      </CodeBlock>
    ) : (
      <code
        className={cn(
          "font-mono [:not(pre)>&]:rounded-md [:not(pre)>&]:bg-background/50 [:not(pre)>&]:px-1 [:not(pre)>&]:py-0.5"
        )}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => children,
  ol: withClass("ol", "list-decimal space-y-2 pl-6"),
  ul: withClass("ul", "list-disc space-y-2 pl-6"),
  li: withClass("li", "my-1.5"),
  table: withClass(
    "table",
    "w-full border-collapse overflow-y-auto rounded-md border border-foreground/20"
  ),
  th: withClass(
    "th",
    "border border-foreground/20 px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right"
  ),
  td: withClass(
    "td",
    "border border-foreground/20 px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
  ),
  tr: withClass("tr", "m-0 border-t p-0 even:bg-muted"),
  p: withClass("p", "whitespace-pre-wrap"),
  hr: withClass("hr", "border-foreground/20"),
}

function withClass(Tag: keyof React.JSX.IntrinsicElements & string, classes: string) {
  const Component = (props: React.HTMLAttributes<HTMLElement> & ExtraProps) => {
    const { node, ...htmlProps } = props
    void node
    return React.createElement(Tag, { ...htmlProps, className: cn(classes, htmlProps.className) })
  }
  Component.displayName = Tag
  return Component
}

export default MarkdownRenderer
