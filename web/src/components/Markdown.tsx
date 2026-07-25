import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("min-w-0 text-sm text-ink", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 leading-6 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-clay underline decoration-clay/50 underline-offset-2 hover:text-clay-bright"
            >
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-ink-faint">
              [remote image omitted{alt ? `: ${alt}` : ""}]
            </span>
          ),
          code: ({ children, className: codeClass }) => {
            const block = Boolean(codeClass?.startsWith("language-")) || String(children).includes("\n");
            return block ? (
              <code className={clsx("font-mono text-xs text-ink", codeClass)}>{children}</code>
            ) : (
              <code className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[0.85em] text-teal">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 max-w-full overflow-x-auto rounded-lg border border-line bg-panel-2 p-3 font-mono text-xs">
              {children}
            </pre>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-clay">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-clay">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5 leading-5">{children}</li>,
          h1: ({ children }) => <h1 className="mb-1 mt-3 text-base font-semibold text-ink">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-3 text-sm font-semibold text-ink">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-ink">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-clay/40 pl-3 text-ink-dim">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-line" />,
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table className="w-full border-collapse readout text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-panel-2 text-ink-dim">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-line px-2 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border border-line px-2 py-1.5">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
