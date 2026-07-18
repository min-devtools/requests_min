import { useEffect } from "react";
import { Icon } from "../ui/Icon";

interface Props {
  x: number;
  y: number;
  onOpen: () => void;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function RequestContextMenu({ x, y, onOpen, onClose, onRename, onDuplicate, onDelete }: Props) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);

  return (
    <div className="index-context-menu" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="context-item" onClick={() => { onClose(); onOpen(); }}><Icon name="request" /><strong>Open request</strong><kbd>↵</kbd></button>
      <button type="button" className="context-item" onClick={() => { onClose(); onRename(); }}><Icon name="pencil" /><strong>Rename request</strong><kbd>⌘E</kbd></button>
      <button type="button" className="context-item" onClick={() => { onClose(); onDuplicate(); }}><Icon name="copy" /><strong>Duplicate request</strong><kbd>⌘D</kbd></button>
      <button type="button" className="context-item danger" onClick={() => { onClose(); onDelete(); }}><Icon name="trash" /><strong>Delete request</strong><kbd>⌘⌫</kbd></button>
    </div>
  );
}
