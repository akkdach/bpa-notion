import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FileText, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import type { TreeNode } from '../hooks/usePageTree'

// ═══════════════════════════════════════════════════════════════════════════
//  PageTree — presentational
//  รับ tree ที่ประกอบแล้วเข้ามา ไม่ fetch เอง
// ═══════════════════════════════════════════════════════════════════════════

interface PageTreeProps {
  nodes: TreeNode[]
  activePageId?: string | undefined
  onSelect: (pageId: string) => void
  onCreateChild: (parentId: string) => void
  onDelete: (pageId: string) => void
}

export function PageTree({ nodes, activePageId, onSelect, onCreateChild, onDelete }: PageTreeProps) {
  if (nodes.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        ยังไม่มีหน้า — กดปุ่ม + ด้านบนเพื่อสร้างหน้าแรก
      </p>
    )
  }

  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <PageTreeItem
          key={node.id}
          node={node}
          activePageId={activePageId}
          onSelect={onSelect}
          onCreateChild={onCreateChild}
          onDelete={onDelete}
        />
      ))}
    </ul>
  )
}

function PageTreeItem({ node, activePageId, onSelect, onCreateChild, onDelete }: {
  node: TreeNode
  activePageId?: string | undefined
  onSelect: (pageId: string) => void
  onCreateChild: (parentId: string) => void
  onDelete: (pageId: string) => void
}) {
  const expandedPageIds = useUiStore((s) => s.expandedPageIds)
  const togglePageExpanded = useUiStore((s) => s.togglePageExpanded)

  const isExpanded = expandedPageIds.includes(node.id)
  const isActive = node.id === activePageId
  const hasChildren = node.children.length > 0

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm',
          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        )}
        // เยื้องตามความลึก — คิดจาก depth ที่เซิร์ฟเวอร์ส่งมา ไม่ใช่นับเองตอน render
        style={{ paddingLeft: `${node.depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => togglePageExpanded(node.id)}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground',
            hasChildren ? 'hover:bg-accent' : 'invisible',
          )}
          aria-label={isExpanded ? 'ย่อ' : 'กาง'}
          aria-expanded={hasChildren ? isExpanded : undefined}
        >
          <motion.span animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronRight className="size-3.5" aria-hidden />
          </motion.span>
        </button>

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        >
          <span aria-hidden className="shrink-0">
            {node.icon ?? <FileText className="size-3.5 text-muted-foreground" />}
          </span>
          <span className="truncate">
            {node.title.length > 0 ? node.title : 'ไม่มีชื่อ'}
          </span>
        </button>

        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onCreateChild(node.id)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent"
            aria-label={`สร้างหน้าย่อยใน ${node.title}`}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
            aria-label={`ย้าย ${node.title} ไปถังขยะ`}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && hasChildren && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <PageTreeItem
                key={child.id}
                node={child}
                activePageId={activePageId}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
                onDelete={onDelete}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  )
}
