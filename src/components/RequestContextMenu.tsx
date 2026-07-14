import { useEffect } from "react";
import { useApp } from "../store";
import { Icon } from "../ui/Icon";

interface Props {
  collectionId: string;
  relPath: string;
  title: string;
  x: number;
  y: number;
  onOpen: () => void;
  onClose: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
}

export function RequestContextMenu({ collectionId, relPath, title, x, y, onOpen, onClose, onRename, onDuplicate }: Props) {
  const { openConfirm, deleteRequest, showToast } = useApp();

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);

  const remove = async () => {
    onClose();
    if (!await openConfirm({ title: "Delete request", message: `Delete "${title}"? This cannot be undone.`, danger: true, confirmLabel: "Delete" })) return;
    try {
      await deleteRequest(collectionId, relPath);
      showToast("Request deleted", title);
    } catch (error) {
      showToast("Delete failed", String(error), "err");
    }
  };

  return (
    <div className="index-context-menu" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="context-item" onClick={() => { onClose(); onOpen(); }}><Icon name="request" /><strong>Open request</strong><kbd>↵</kbd></button>
      {onRename && <button type="button" className="context-item" onClick={() => { onClose(); onRename(); }}><Icon name="pencil" /><strong>Rename request</strong><kbd /></button>}
      {onDuplicate && <button type="button" className="context-item" onClick={() => { onClose(); onDuplicate(); }}><Icon name="copy" /><strong>Duplicate request</strong><kbd /></button>}
      <button type="button" className="context-item danger" onClick={() => void remove()}><Icon name="trash" /><strong>Delete request</strong><kbd>⌫</kbd></button>
    </div>
  );
}
