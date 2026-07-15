import type { CSSProperties } from "react";
import {
  Activity,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Code2,
  Database,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  Key,
  List,
  Keyboard,
  Minimize2,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plug,
  Plus,
  Radio,
  Rows3,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  SortAsc,
  SortDesc,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  activity: Activity,
  braces: Braces,
  check: Check,
  "chevron-down": ChevronDown,
  copy: Copy,
  code: Code2,
  database: Database,
  folder: FolderOpen,
  github: GitBranch,
  globe: Globe,
  grpc: Boxes,
  history: History,
  key: Key,
  list: List,
  keyboard: Keyboard,
  minify: Minimize2,
  moon: Moon,
  "more-horizontal": MoreHorizontal,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  pencil: Pencil,
  plug: Plug,
  plus: Plus,
  refresh: RefreshCw,
  rows: Rows3,
  request: FileCode2,
  save: Save,
  search: Search,
  send: Send,
  settings: Settings2,
  "sort-asc": SortAsc,
  "sort-desc": SortDesc,
  sparkles: Sparkles,
  sun: Sun,
  trash: Trash2,
  wand: Wand2,
  ws: Radio,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 15, style, className }: Props) {
  const Component = ICONS[name];
  return <Component size={size} strokeWidth={1.8} style={{ flex: "none", ...style }} className={className} aria-hidden />;
}
