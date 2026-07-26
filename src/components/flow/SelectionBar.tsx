import { AnimatePresence, motion } from "motion/react";
import { Panel } from "@xyflow/react";
import { useApp } from "../../store";
import { Icon } from "../../ui/Icon";

/** Floating group-action bar; visible only while 2+ blocks are selected and no run is live. */
export function SelectionBar({ tabId, onCopy, onDuplicate, onDelete, onAlign, onDistribute }: {
  tabId: string;
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (axis: "x" | "y") => void;
  onDistribute: (axis: "x" | "y") => void;
}) {
  const count = useApp((state) => state.flowTabs[tabId]?.selectedNodeIds.length ?? 0);
  const running = useApp((state) => state.flowTabs[tabId]?.running ?? false);
  const visible = count >= 2 && !running;
  return (
    <Panel position="bottom-center" className="flow-selection-panel">
      <AnimatePresence>
        {visible && (
          <motion.div
            className="flow-selection-bar"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          >
            <span className="flow-selection-count">{count} selected</span>
            <button type="button" className="tool-btn icon-only" title="Copy (⌘C)" onClick={onCopy}><Icon name="copy" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Duplicate" onClick={onDuplicate}><Icon name="duplicate" size={14} /></button>
            <button type="button" className="tool-btn icon-only danger" title="Delete…" onClick={onDelete}><Icon name="trash" size={14} /></button>
            <span className="flow-selection-divider" />
            <button type="button" className="tool-btn icon-only" title="Align in a row" onClick={() => onAlign("y")}><Icon name="align-h" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Align in a column" onClick={() => onAlign("x")}><Icon name="align-v" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Distribute horizontally" disabled={count < 3} onClick={() => onDistribute("x")}><Icon name="dist-h" size={14} /></button>
            <button type="button" className="tool-btn icon-only" title="Distribute vertically" disabled={count < 3} onClick={() => onDistribute("y")}><Icon name="dist-v" size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
