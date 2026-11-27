import type { FileContents, FileOptions } from "@pierre/diffs";
import { Editor, type EditorOptions, type EditorType } from "@pierre/diffs/edit";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import type { ReactNode } from "react";

interface FileEditorProps {
	readonly relativePath: string;
	readonly contents: string;
	readonly revealLine: number | undefined;
	readonly editable: boolean;
	readonly theme: "dark" | "light";
	readonly shiki: string;
	readonly reloadVersion: number;
	readonly documentRevision: string | null;
	readonly editorOptions: EditorOptions<"file", undefined, undefined>;
}

const FILE_EDITOR_SURFACE_CSS = `
	:host {
		--diffs-bg: transparent !important;
		--diffs-light-bg: transparent !important;
		--diffs-dark-bg: transparent !important;
		--diffs-font-size: 0.75rem;
		--diffs-line-height: 1.125rem;
		background-color: transparent !important;
		color: var(--foreground) !important;
	}
	[data-search-panel] { --diffs-bg: var(--pane-surface); }
`;

function createEditor<EType extends EditorType>(
	editorType: EType,
	options: EditorOptions<EType, undefined, undefined>,
	editStateKey?: string,
): Editor<EType, undefined, undefined> {
	return new Editor(editorType, options, editStateKey);
}

export function FilesEditProvider({ children }: { readonly children: ReactNode }) {
	return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}

export function FileEditor({
	relativePath,
	contents,
	revealLine,
	editable,
	theme,
	shiki,
	reloadVersion,
	documentRevision,
	editorOptions,
}: FileEditorProps) {
	const file: FileContents = {
		name: relativePath,
		contents,
		cacheKey: `${relativePath}:${documentRevision ?? "readonly"}:${String(reloadVersion)}`,
	};
	const options: FileOptions<undefined, undefined> = {
		disableFileHeader: true,
		overflow: "wrap",
		theme: shiki,
		themeType: theme,
		unsafeCSS: FILE_EDITOR_SURFACE_CSS,
	};

	return (
		<Virtualizer
			className="files-editor-scroll min-h-0 flex-1 overflow-auto"
			data-qa-id="files-editor"
		>
			<File
				className="min-h-full"
				disableWorkerPool
				edit={editable}
				editorOptions={editorOptions}
				file={file}
				options={options}
				{...(revealLine === undefined
					? {}
					: { selectedLines: { start: revealLine, end: revealLine } })}
			/>
		</Virtualizer>
	);
}
