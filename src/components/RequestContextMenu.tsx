import { ContextMenu } from "../ui/ContextMenu";

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
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        { icon: "request", label: "Open request", strong: true, kbd: "↵", onClick: onOpen },
        { icon: "pencil", label: "Rename request", strong: true, kbd: "⌘E", onClick: onRename },
        { icon: "copy", label: "Duplicate request", strong: true, kbd: "⌘D", onClick: onDuplicate },
        { icon: "trash", label: "Delete request", strong: true, danger: true, kbd: "⌘⌫", onClick: onDelete },
      ]}
    />
  );
}
