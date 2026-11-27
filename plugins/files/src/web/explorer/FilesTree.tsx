import { resolveTheme } from "@pierre/diffs";
import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { CircleAlertIcon, FolderIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
} from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import type { FileGitStatusEntry } from "../../contracts/models.js";
import { FILE_ICONS } from "../file-icons/file-icons.js";
import { explorerRootTitle, folderName } from "./explorer-title.js";
import { captureExpandedPaths } from "./tree-expansion.js";
import { useFileTreeWatcher } from "./file-tree-watcher.js";
import { useFilesTheme } from "../theme.js";

export interface FilesWorkspaceFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

interface FilesTreeProps {
	readonly paths: readonly string[];
	readonly loading: boolean;
	readonly truncated: boolean;
	readonly error: string | null;
	readonly gitStatusEntries: readonly FileGitStatusEntry[] | null;
	readonly activePath: string | null;
	readonly workspaceDirectory: string;
	readonly workspaceFolders: readonly FilesWorkspaceFolder[];
	readonly selectionSyncVersion: number;
	readonly onOpenFile: (relativePath: string) => void;
	readonly onSelectWorkspaceFolder: (path: string) => void;
	readonly onRefresh: () => void;
}

export function FilesTree({
	paths,
	loading,
	truncated,
	error,
	gitStatusEntries,
	activePath,
	workspaceDirectory,
	workspaceFolders,
	selectionSyncVersion,
	onOpenFile,
	onSelectWorkspaceFolder,
	onRefresh,
}: FilesTreeProps) {
	const openFileRef = useLatestRef(onOpenFile);
	const syncingSelectionRef = useRef(false);
	const { model } = useFileTree({
		paths: [],
		density: "compact",
		icons: FILE_ICONS,
		flattenEmptyDirectories: true,
		initialExpansion: "closed",
		fileTreeSearchMode: "hide-non-matches",
		search: false,
		unsafeCSS: `
			[data-type="item"] {
				--truncate-marker-background-color: var(--pane-surface);
				--truncate-marker-fade-in-duration: 0s;
			}

			/* The tree shows the "…" marker when its cell is taller than 1lh, but at
			   fractional zoom (e.g. 80%, 110%) sub-pixel rounding makes an unwrapped
			   cell ~24.02px vs 24px, so every row gets a marker. A real overflow
			   wraps to 2lh, so test against 1.5lh instead.
			   https://github.com/pierrecomputer/pierre/issues/816 */
			[data-truncate-marker] {
				opacity: 0;
			}

			@container measure (height > 1.5lh) {
				[data-truncate-marker] {
					opacity: 1;
				}
			}

			/* The inherited app scrollbar-color disables the tree's 6px
			   ::-webkit-scrollbar, so a stable gutter would reserve a full-width
			   strip; only take the space while overflowing. */
			[data-file-tree-virtualized-scroll="true"] {
				scrollbar-gutter: auto;
				scrollbar-width: thin;
				padding-inline: max(calc(var(--trees-padding-inline) - var(--trees-item-margin-x)), 0px);
			}

			button[data-type="item"][data-item-type="file"]::before {
				display: none;
			}

			[data-item-type="file"][data-item-path$=".ipynb" i] [data-item-section="icon"] {
				color: light-dark(#d47628, #ffa359);
			}
		`,
		onSelectionChange(selectedPaths) {
			if (syncingSelectionRef.current) return;
			const selected = selectedPaths.at(-1);
			if (selected && !selected.endsWith("/")) openFileRef.current(selected);
		},
	});
	const search = useFileTreeSearch(model);
	const [treeStyles, setTreeStyles] = useState<CSSProperties>({});
	useFileTreeWatcher(workspaceDirectory);
	const { mode, shiki } = useFilesTheme();
	const folderOptions = workspaceFolders.map(({ path }) => ({
		value: path,
		label: explorerRootTitle(path, workspaceFolders),
	}));

	useEffect(() => {
		// resetPaths collapses to the baseline, so re-plant the expansion the
		// model had before the new list lands (first mount captures nothing).
		model.resetPaths(paths, { initialExpandedPaths: captureExpandedPaths(model) });
	}, [model, paths]);

	useEffect(() => {
		model.setGitStatus(gitStatusEntries ?? undefined);
	}, [model, gitStatusEntries]);

	// Mirrors the active file into the tree's selection. Re-run when the paths
	// reset (the item may only exist now) and when the host asks for a re-sync.
	const selectActivePath = useEffectEvent(
		(tree: typeof model, path: string, _paths: readonly string[], _syncVersion: number) => {
			const item = tree.getItem(path);
			if (!item) return;
			syncingSelectionRef.current = true;
			for (const selected of tree.getSelectedPaths()) tree.getItem(selected)?.deselect();
			item.select();
			queueMicrotask(() => {
				syncingSelectionRef.current = false;
			});
		},
	);
	useEffect(() => {
		if (activePath) selectActivePath(model, activePath, paths, selectionSyncVersion);
	}, [activePath, model, paths, selectionSyncVersion]);

	useEffect(() => {
		let active = true;
		void resolveTheme(shiki).then(
			(resolved) => {
				if (active) setTreeStyles(themeToTreeStyles(resolved) as CSSProperties);
			},
			() => {
				if (active) setTreeStyles({ colorScheme: mode });
			},
		);
		return () => {
			active = false;
		};
	}, [mode, shiki]);

	// The tree only reports selection *changes*, so clicking the already-selected
	// file (e.g. after its pane was closed) would otherwise do nothing. Capture
	// runs before the tree's own row handler, while the selection is still the
	// pre-click one.
	const reopenSelectedFileOnClick = (event: ReactMouseEvent) => {
		if (!isPlainSingleClick(event)) return;
		const path = clickedFileRowPath(event.nativeEvent);
		if (!path) return;
		const selected = model.getSelectedPaths();
		if (selected.length === 1 && selected[0] === path) openFileRef.current(path);
	};

	return (
		// The capture only re-opens an already-selected row on mouse click; the tree
		// handles keyboard activation of its rows itself.
		// react-doctor-disable-next-line react-doctor/click-events-have-key-events
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent"
			data-qa-id="files-explorer"
			onClickCapture={reopenSelectedFileOnClick}
		>
			{folderOptions.length > 1 ? (
				<div className="shrink-0 px-2 pt-1.5">
					<Select
						items={folderOptions}
						value={workspaceDirectory}
						onValueChange={(value) => {
							if (value && value !== workspaceDirectory) onSelectWorkspaceFolder(value);
						}}
					>
						<SelectTrigger
							aria-label="Workspace folder"
							className="w-full min-w-0 text-sm"
							data-qa-id="files-folder-select"
							size="sm"
						>
							<FolderIcon className="text-muted-foreground size-3.5" />
							<SelectValue>
								{(value) =>
									folderOptions.find((option) => option.value === value)?.label ?? folderName(value)
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{folderOptions.map((option) => (
									<SelectItem
										aria-description={option.value}
										key={option.value}
										value={option.value}
									>
										<span className="min-w-0 truncate">{option.label}</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			) : null}
			<div className="flex h-10 shrink-0 items-center gap-1 px-2">
				<InputGroup size="sm" variant="filled" className="min-w-0 flex-1">
					<InputGroupInput
						type="search"
						aria-label="Search workspace files"
						data-qa-id="files-search"
						placeholder="Search files"
						value={search.value}
						onChange={(event) => {
							const value = event.currentTarget.value;
							if (value.trim()) search.setValue(value);
							else search.close();
						}}
					/>
					<InputGroupAddon>
						<SearchIcon aria-hidden="true" />
					</InputGroupAddon>
				</InputGroup>
				<Tooltip disableHoverablePopup>
					<TooltipTrigger
						render={
							<Button
								aria-label="Refresh files"
								data-qa-id="files-refresh"
								disabled={loading}
								onClick={onRefresh}
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<RefreshCwIcon className={loading ? "animate-spin" : undefined} />
					</TooltipTrigger>
					<TooltipContent side="bottom">Refresh files</TooltipContent>
				</Tooltip>
			</div>
			{truncated ? (
				<p className="text-muted-foreground text-2xs px-3 py-1.5">
					Showing the first 25,000 entries.
				</p>
			) : null}
			{error ? (
				<Empty data-qa-id="files-list-error">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CircleAlertIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Could not load files</EmptyTitle>
						<EmptyDescription>{error}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : !loading && paths.length === 0 ? (
				<Empty data-qa-id="files-empty">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FolderIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No files</EmptyTitle>
						<EmptyDescription>This workspace has no files to display.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<FileTree
					aria-label="Workspace files"
					className="min-h-0 flex-1 overflow-hidden py-2"
					data-qa-id="files-tree"
					model={model}
					style={{
						...treeStyles,
						backgroundColor: "transparent",
						borderColor: "var(--border)",
						color: "var(--foreground)",
						["--trees-fg-override" as string]: "var(--foreground)",
						["--trees-bg-override" as string]: "transparent",
						["--trees-bg-muted-override" as string]:
							"color-mix(in oklab, var(--foreground) 5%, transparent)",
						["--trees-selected-bg-override" as string]:
							"color-mix(in oklab, var(--foreground) 5%, transparent)",
						["--trees-border-color-override" as string]: "var(--border)",
						["--trees-focus-ring-color-override" as string]: "var(--ring)",
						["--trees-padding-inline-override" as string]: "8px",
						["--trees-selected-focused-border-color-override" as string]: "var(--ring)",
						["--trees-scrollbar-thumb-override" as string]: "var(--app-scrollbar-thumb)",
					}}
				/>
			)}
		</div>
	);
}

function isPlainSingleClick(event: ReactMouseEvent): boolean {
	return (
		event.button === 0 &&
		event.detail <= 1 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

// Rows live in the tree's open shadow root, so the React event target is
// retargeted to the host; composedPath() still reaches the row button.
function clickedFileRowPath(event: MouseEvent): string | null {
	for (const node of event.composedPath()) {
		if (!(node instanceof Element)) continue;
		if (node.matches('button[data-type="item"][data-item-type="file"]')) {
			return node.getAttribute("data-item-path");
		}
	}
	return null;
}
