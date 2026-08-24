import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  Archive,
  Copy,
  FileJson,
  Image as ImageIcon,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { LucideIcon } from "lucide-react";
import {
  BUCKETS,
  MODALITIES,
  bucketOf,
  inspectExamConsistency,
  lastOpenedLabel,
  readImportedImageFiles,
  uid,
  type CreateExamContext,
  type Examination,
  type ExamImage,
} from "../lib/examinations";
import { downloadJson } from "../lib/exportImage";
import type { ExamSyncStatus } from "../lib/db/examinationStore";
import { Button, Modal } from "./ui";

/* --------------------------- Indicateur discret de sync -------------------- */

/** État interne minimal exigé par SUITE.md §10 — une pastille, rien de plus. */
function SyncBadge({ status }: { status: ExamSyncStatus }) {
  const label =
    status === "synced" ? "Saved"
    : status === "syncing" ? "Syncing…"
    : status === "error" ? "Sync error"
    : "Local only";
  const cls =
    status === "synced" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : status === "syncing" ? "border-sky-500/30 bg-sky-500/10 text-sky-300 animate-pulse"
    : status === "error" ? "border-red-500/40 bg-red-500/10 text-red-300"
    : "border-border bg-btn text-ink-3";
  return (
    <span
      data-attr="exam-sync-status"
      className={cn("rounded-full border px-2 py-px text-[10px] font-medium", cls)}
    >
      {label}
    </span>
  );
}

/* ------------------------------- Header items ------------------------------- */

function HeaderMenu({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div className="absolute right-0 top-full z-[100] mt-1.5 min-w-48 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop">
        {children}
      </div>
    </>
  );
}

function HeaderEntry({
  label,
  danger,
  shortcut,
  onSelect,
  data,
}: {
  label: string;
  danger?: boolean;
  shortcut?: string;
  onSelect: () => void;
  data?: string;
}) {
  return (
    <button
      type="button"
      data-attr={data}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-6 rounded-lg px-2.5 py-[5px] text-left text-[12.5px] transition-colors duration-100 hover:bg-hover",
        danger ? "text-red-400" : "text-ink",
      )}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[11px] text-ink-3">{shortcut}</span>}
    </button>
  );
}

/* ------------------------------ Context menu ------------------------------- */

const CTX_ITEMS: { key: string; label: string; icon: LucideIcon; danger?: boolean }[] = [
  { key: "rename", label: "Rename", icon: Pencil },
  { key: "duplicate", label: "Duplicate", icon: Copy },
  { key: "export", label: "Export Report", icon: FileJson },
  { key: "import", label: "Import Images", icon: Upload },
  { key: "move", label: "Move to Archive", icon: Archive },
  { key: "properties", label: "Properties", icon: MoreHorizontal },
  { key: "delete", label: "Delete", icon: Trash2, danger: true },
];

/* ------------------------------- Exam card --------------------------------- */

function ExamCard({
  exam,
  selected,
  onSelect,
  onOpen,
  onContext,
}: {
  exam: Examination;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContext: (e: React.MouseEvent, id: string) => void;
}) {
  const img = exam.images[0];
  return (
    <div
      data-attr={`exam-card-${exam.id}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) => onContext(e, exam.id)}
      className={cn(
        "group cursor-pointer overflow-hidden rounded-[14px] border bg-card transition-all duration-150 ease-out",
        selected
          ? "border-accent shadow-lg shadow-black/30"
          : "border-border hover:-translate-y-0.5 hover:border-accent/70 hover:shadow-lg hover:shadow-black/30",
      )}
    >
      <div className="relative flex h-32 items-center justify-center overflow-hidden bg-canvas">
        {img ? (
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon size={28} className="text-ink-3/50" strokeWidth={1.5} />
        )}
        <span className="absolute left-2 top-2 rounded-md border border-border bg-[#0e0e0e]/80 px-1.5 py-0.5 text-[10.5px] text-ink-2 backdrop-blur-sm">
          {exam.modality}
        </span>
      </div>
      <div className="space-y-0.5 p-3">
        <p className="truncate text-[12.5px] font-medium text-ink" title={exam.name}>
          {exam.name}
        </p>
        <p className="text-[11px] text-ink-3">
          {exam.images.length} {exam.images.length === 1 ? "image" : "images"}
        </p>
        <p className="text-[11px] text-ink-3">
          Last opened : <span className="text-ink-2">{lastOpenedLabel(exam.lastOpenedAt, exam.archived)}</span>
        </p>
      </div>
    </div>
  );
}

/* ----------------------------- New exam card ------------------------------- */

function NewExamCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-attr="exam-new"
      onClick={onClick}
      className="flex h-full min-h-44 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border text-ink-2 transition-all duration-150 ease-out hover:border-accent/70 hover:text-ink hover:bg-card"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-btn transition-colors duration-150 group-hover:bg-hover">
        <Plus size={18} strokeWidth={2.2} />
      </span>
      <span className="text-[12.5px] font-medium">New Examination</span>
    </button>
  );
}

/* ------------------------------ Create dialog ------------------------------ */

function CreateExamDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, modality: string, images: ExamImage[]) => void;
}) {
  const [name, setName] = useState("");
  const [modality, setModality] = useState("Radiography");
  const [images, setImages] = useState<ExamImage[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imported = await readImportedImageFiles(files);
    setImportWarnings(imported.warnings);
    if (imported.images.length > 0) setImages((prev) => [...prev, ...imported.images]);
  };
  const consistencyIssues = inspectExamConsistency(images);

  return (
    <Modal title="Create examination" onClose={onClose} width="w-96">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] text-ink-2">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) onCreate(name.trim(), modality, images);
            }}
            placeholder="e.g. Thorax_2026_08_03"
            data-attr="exam-name-input"
            className="w-full rounded-[14px] border border-border bg-panel px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-3/80 hover:bg-[#292929] focus:border-[#3B82F6] focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] text-ink-2">Modality</label>
          <div className="flex flex-wrap gap-1.5">
            {MODALITIES.map((m) => (
              <button
                key={m}
                type="button"
                data-attr={`exam-modality-${m.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setModality(m)}
                className={cn(
                  "rounded-[10px] px-2.5 py-1 text-[12px] transition-colors duration-100",
                  modality === m
                    ? "border border-accent/60 bg-accent/15 text-accent"
                    : "border border-border bg-btn text-ink-2 hover:bg-hover hover:text-ink",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] text-ink-2">Import Images</label>
          <button
            type="button"
            data-attr="exam-import-btn"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-between rounded-[14px] border border-dashed border-border bg-panel px-3.5 py-2.5 text-[12.5px] text-ink-2 transition-colors duration-150 hover:border-accent/70 hover:bg-hover"
          >
            <span className="flex items-center gap-2">
              <Upload size={14} />
              Choose files
            </span>
            <span data-attr="exam-import-count" className="text-[11px] tabular-nums text-ink-3">
              {images.length} {images.length === 1 ? "image" : "images"}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.dcm,.dicom,application/dicom"
            multiple
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
          />
          {(importWarnings.length > 0 || consistencyIssues.length > 0) && (
            <div className="mt-2 space-y-1.5">
              {[...importWarnings, ...consistencyIssues.map((issue) => issue.message)].map((message, index) => (
                <p
                  key={`${message}-${index}`}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-[10.5px] leading-relaxed",
                    consistencyIssues.some((issue) => issue.level === "error" && issue.message === message)
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                  )}
                >
                  {message}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" data="exam-create-btn" disabled={!name.trim()} onClick={() => onCreate(name.trim(), modality, images)}>
          Create
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Exams screen ------------------------------- */

export function ExamsScreen({
  exams,
  onCreateExam,
  onUpdateExam,
  onDeleteExam,
  onOpenExam,
  onOpenStandalone,
  onSignOut,
  userEmail,
  syncStatus,
}: {
  exams: Examination[];
  onCreateExam: (e: Examination, context?: CreateExamContext) => void;
  onUpdateExam: (id: string, patch: Partial<Examination>) => void;
  onDeleteExam: (id: string) => void;
  onOpenExam: (id: string) => void;
  onOpenStandalone: () => void;
  onSignOut: () => void;
  userEmail: string;
  /** État de synchronisation Supabase ; undefined = indicateur masqué. */
  syncStatus?: ExamSyncStatus;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [propertiesId, setPropertiesId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [light, setLight] = useState(() => localStorage.getItem("aimaging.theme") === "light");
  const [dragging, setDragging] = useState(false);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  const toggleTheme = () => {
    setLight((v) => {
      const nv = !v;
      localStorage.setItem("aimaging.theme", nv ? "light" : "dark");
      return nv;
    });
  };

  const sorted = useMemo(() => [...exams].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)), [exams]);
  const byBucket = useMemo(() => {
    const m = new Map<string, Examination[]>();
    for (const b of BUCKETS) m.set(b, []);
    for (const e of sorted) m.get(bucketOf(e.lastOpenedAt, e.archived))?.push(e);
    return m;
  }, [sorted]);
  const total = sorted.length;
  const visibleBuckets = BUCKETS.filter((b) => (byBucket.get(b)?.length ?? 0) > 0);

  const createFromFiles = async (files: FileList) => {
    const imported = await readImportedImageFiles(files);
    const imgs = imported.images;
    setImportNotices([...imported.warnings, ...inspectExamConsistency(imgs).map((issue) => issue.message)]);
    if (imgs.length === 0) return;
    const now = new Date().toISOString();
    onCreateExam(
      {
        id: uid(),
        name: `Examination ${now.slice(0, 10).replace(/-/g, "_")}`,
        modality: "Radiography",
        images: imgs,
        createdAt: now,
        lastOpenedAt: now,
        archived: false,
      },
      { originalFiles: imported.originalFiles },
    );
  };

  const ctxAction = (key: string, id: string) => {
    const exam = exams.find((e) => e.id === id);
    if (!exam) return;
    switch (key) {
      case "rename":
        setRenameValue(exam.name);
        setRenameId(id);
        break;
      case "duplicate":
        /* Phase Database 4 : duplication copy-on-duplicate validée (§17 A). */
        onCreateExam(
          {
            ...exam,
            id: uid(),
            name: `${exam.name} (copy)`,
            images: exam.images.map((i) => ({ ...i, id: uid(), state: undefined })),
            createdAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            archived: false,
          },
          { duplicatedFrom: exam.id },
        );
        break;
      case "export":
        downloadJson(
          {
            app: "AImaging",
            examName: exam.name,
            modality: exam.modality,
            imageCount: exam.images.length,
            createdAt: exam.createdAt,
            lastOpenedAt: exam.lastOpenedAt,
          },
          `${exam.name}.aimaging.json`,
        );
        break;
      case "import":
        importRef.current?.click();
        break;
      case "move":
        onUpdateExam(id, { archived: !exam.archived });
        break;
      case "properties":
        setPropertiesId(id);
        break;
      case "delete":
        setDeleteId(id);
        break;
    }
  };

  const onDrop = async (e: ReactDragEvent) => {
    e.preventDefault();
    setDragging(false);
    await createFromFiles(e.dataTransfer.files);
  };

  const accountName = userEmail.split("@")[0] || "User";

  return (
    <div
      className={cn(
        "flex h-screen w-screen select-none flex-col overflow-hidden bg-bg font-sans text-ink",
        light && "theme-light",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-8 border-b border-border bg-titlebar px-5">
        <div className="flex items-center gap-2.5">
          <img src="/logo_dark_transparent.png" alt="AImaging" data-attr="exam-logo" className="app-logo h-6 w-min" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              data-attr="exam-settings"
              onClick={() => {
                setSettingsOpen((o) => !o);
                setAccountOpen(false);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <Settings size={15} />
              Settings
            </button>
            <HeaderMenu open={settingsOpen} onClose={() => setSettingsOpen(false)}>
              <HeaderEntry label="Open standalone editor" shortcut="Demo" onSelect={() => { setSettingsOpen(false); onOpenStandalone(); }} />
              <div className="mx-2 my-1 h-px bg-border" />
              <HeaderEntry label="Reset examination data" danger onSelect={() => { setSettingsOpen(false); if (confirm("Delete all examinations? This cannot be undone.")) { for (const e of exams) onDeleteExam(e.id); } }} />
            </HeaderMenu>
          </div>

          <button
            type="button"
            data-attr="theme-toggle"
            onClick={toggleTheme}
            title="Dark mode"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            {light ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <div className="relative">
            <button
              type="button"
              data-attr="exam-account"
              onClick={() => {
                setAccountOpen((o) => !o);
                setSettingsOpen(false);
              }}
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold text-accent">
                {accountName.slice(0, 1).toUpperCase()}
              </span>
              {accountName}
            </button>
            <HeaderMenu open={accountOpen} onClose={() => setAccountOpen(false)}>
              <p className="px-2.5 py-1 text-[11px] text-ink-3" data-attr="account-email">
                {userEmail}
              </p>
              <div className="mx-2 my-1 h-px bg-border" />
              <HeaderEntry label="Sign out" data="account-signout" onSelect={() => { setAccountOpen(false); onSignOut(); }} />
            </HeaderMenu>
          </div>
        </div>
      </header>

      {importNotices.length > 0 && (
        <div className="absolute right-5 top-16 z-[120] w-[min(440px,calc(100vw-40px))] space-y-1.5">
          {importNotices.slice(0, 4).map((message, index) => (
            <p key={`${message}-${index}`} className="rounded-lg border border-amber-500/30 bg-[#252014] px-3 py-2 text-[11px] leading-relaxed text-amber-100 shadow-lg">
              {message}
            </p>
          ))}
        </div>
      )}

      {/* Content */}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-16 pt-6">
        <div className="flex items-center gap-2">
          <h1 className="text-[17px] font-semibold tracking-tight">Recent examinations</h1>
          {syncStatus !== undefined && <SyncBadge status={syncStatus} />}
        </div>

        {total === 0 && (
          <p className="mt-2 text-[12.5px] text-ink-3">
            No examinations yet — create one or drop images anywhere.
          </p>
        )}

        {BUCKETS.map((bucket) => {
          const items = byBucket.get(bucket) ?? [];
          if (items.length === 0) return null;
          const isFirst = bucket === visibleBuckets[0];
          return (
            <section key={bucket} className="mt-6">
              <h2 className="mb-2.5 text-[13px] font-medium text-ink-2">{bucket}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {isFirst && (
                  <NewExamCard onClick={() => setCreateOpen(true)} />
                )}
                {items.map((exam) => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    selected={selectedId === exam.id}
                    onSelect={() => setSelectedId(exam.id)}
                    onOpen={() => onOpenExam(exam.id)}
                    onContext={(e, id) => {
                      e.preventDefault();
                      setCtx({ x: e.clientX, y: e.clientY, id });
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {total === 0 && (
          <div className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <NewExamCard onClick={() => setCreateOpen(true)} />
            </div>
          </div>
        )}
      </main>

      {/* Context menu */}
      {ctx && (
        <>
          <div
            className="fixed inset-0 z-[130]"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx(null);
            }}
          />
          <div
            className="fixed z-[140] min-w-44 rounded-xl border border-border bg-[#222222] p-1 shadow-xl shadow-black/40 animate-pop"
            style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 290) }}
          >
            {CTX_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                data-attr={`ctx-${item.key}`}
                onClick={() => {
                  setCtx(null);
                  ctxAction(item.key, ctx.id);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-[5px] text-left text-[12.5px] transition-colors duration-100 hover:bg-hover",
                  item.danger ? "text-red-400" : "text-ink",
                )}
              >
                <item.icon size={13} strokeWidth={2} className={item.danger ? "text-red-400" : "text-ink-3"} />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Dialogs */}
      <CreateExamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(name, modality, images) => {
          const now = new Date().toISOString();
          onCreateExam({
            id: uid(),
            name,
            modality,
            images,
            createdAt: now,
            lastOpenedAt: now,
            archived: false,
          });
          setCreateOpen(false);
        }}
      />

      {renameId && (
        <Modal title="Rename examination" onClose={() => setRenameId(null)} width="w-80">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) {
                onUpdateExam(renameId, { name: renameValue.trim() });
                setRenameId(null);
              }
            }}
            data-attr="rename-input"
            className="w-full rounded-[14px] border border-border bg-panel px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition-colors duration-150 hover:bg-[#292929] focus:border-[#3B82F6] focus:ring-2 focus:ring-accent/40"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button
              variant="primary"
              data="rename-save"
              disabled={!renameValue.trim()}
              onClick={() => {
                onUpdateExam(renameId, { name: renameValue.trim() });
                setRenameId(null);
              }}
            >
              Rename
            </Button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Delete examination" onClose={() => setDeleteId(null)} width="w-80">
          <p className="text-[12.5px] text-ink-2">
            Delete “{exams.find((e) => e.id === deleteId)?.name}”? This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="primary"
              data="delete-confirm"
              className="bg-red-500 hover:bg-red-400 active:bg-red-600"
              onClick={() => {
                onDeleteExam(deleteId);
                setDeleteId(null);
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {propertiesId && (() => {
        const exam = exams.find((e) => e.id === propertiesId);
        if (!exam) return null;
        const rows: [string, string][] = [
          ["Name", exam.name],
          ["Modality", exam.modality],
          ["Images", String(exam.images.length)],
          ["Created", new Date(exam.createdAt).toLocaleString()],
          ["Last opened", new Date(exam.lastOpenedAt).toLocaleString()],
          ["Status", exam.archived ? "Archived" : "Active"],
        ];
        return (
          <Modal title="Examination properties" onClose={() => setPropertiesId(null)} width="w-80" data="exam-properties">
            <div className="space-y-1.5">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12px] text-ink-3">{k}</span>
                  <span className="truncate text-right text-[12px] text-ink-2">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => setPropertiesId(null)}>Close</Button>
            </div>
          </Modal>
        );
      })()}

      <input
        ref={importRef}
        type="file"
        accept="image/*,.dcm,.dicom,application/dicom"
        multiple
        className="hidden"
        onChange={(e) => {
          if (ctx) void createFromFiles(e.target.files as FileList);
          e.target.value = "";
        }}
      />

      {/* Drag & drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-card px-10 py-8 text-center">
            <Upload size={28} className="mx-auto text-accent" />
            <p className="mt-3 text-[14px] font-medium text-ink">Drop images to create a new examination</p>
            <p className="mt-1 text-[12px] text-ink-3">PNG, JPEG… a folder works too</p>
          </div>
        </div>
      )}
    </div>
  );
}
