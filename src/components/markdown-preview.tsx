import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

/**
 * Preview de markdown (paso 4.4): react-markdown + GFM + SIEMPRE
 * rehype-sanitize. Sin rehype-raw a propósito: el HTML crudo de un reporte
 * no se interpreta; las imágenes/links legítimos van por sintaxis markdown.
 *
 * Los estilos viven en globals.css (.markdown-preview).
 */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
