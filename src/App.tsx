import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {
    Columns3,
    Download,
    GripVertical,
    LayoutList,
    LogOut,
    Minus,
    Plus,
    Search,
    X
} from "lucide-react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {fetchSamples, setManualOverride, updateStatus} from "./api";
import {AuthGate} from "./AuthGate";
import {supabase} from "./supabase";
import type {GrainBox, Replicate, ReviewStatus, SampleRecord} from "./types";
import {StatusPicker, StatusPill, type StatusPickerState} from "./components/StatusPicker";
import {STATUS_COLUMNS, statusLabel} from "./components/status";
import {formatConfidence, QualityBadge, replicateSuffix} from "./components/Quality.tsx";
import {
    buildEntries,
    ENTRY_FILTERS,
    entryPhotos,
    type EntryFilter,
    type EntryRecord,
    filterEntries,
    gradeDisplayName,
    LARGE_DIFFERENCE_POINTS,
    type SampleResult,
} from "./entries";
import {downloadRecordsCsv} from "./csv";
import "./App.css";

type View = "entry" | "kanban";

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

const EM_DASH = "\u2014";

function captureTime(record: Replicate): string {
    return record.capturedAt ?? record.createdAt;
}

function formatOptionalDate(value: string | null): string {
    return value ? formatDate(value) : EM_DASH;
}

function formatSampleNo(record: { sampleNo: number | null }): string {
    return record.sampleNo ? `${record.sampleNo} of 2` : EM_DASH;
}

function formatProcessing(record: Replicate): string {
    if (!record.capturedAt || !record.submittedAt) return EM_DASH;
    const total = (new Date(record.submittedAt).getTime() - new Date(record.capturedAt).getTime()) / 1000;
    if (!Number.isFinite(total) || total < 0) return EM_DASH;
    if (total < 60) return `${total.toFixed(1)} s`;
    const minutes = Math.floor(total / 60);
    return `${minutes} min ${(total - minutes * 60).toFixed(0)} s`;
}

function formatGrade(grade: string): string {
    return grade === "Below Standard" ? "Not classified" : grade;
}

function sampleKey(sample: SampleRecord): string {
    return `${sample.season ?? ""}|${sample.indexNumber ?? ""}|${sample.sampleNo ?? ""}`;
}

function findSiblingSample(sample: SampleRecord, samples: SampleRecord[]): SampleRecord | null {
    if (!sample.season || !sample.indexNumber) return null;
    return samples.find((other) => sampleKey(other) !== sampleKey(sample) && other.season === sample.season && other.indexNumber === sample.indexNumber) ?? null;
}

function patchReplicate(samples: SampleRecord[] = [], id: string, patch: Partial<Replicate>): SampleRecord[] {
    return samples.map((sample) => sample.replicates.some((record) => record.id === id)
        ? {...sample, replicates: sample.replicates.map((record) => record.id === id ? {...record, ...patch} : record)}
        : sample);
}

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6];

function GrainCanvas({image, grains, color, zoom}: {
    image: HTMLImageElement;
    grains: GrainBox[];
    color?: string;
    zoom: number
}) {
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;

    return <div className="grain-stage"
                style={{
                    position: "relative",
                    width: `${zoom * 100}%`,
                    aspectRatio: `${width} / ${height}`,
                    justifySelf: "start",
                    alignSelf: "start"
                }}>
        <img src={image.src} alt=""
             style={{display: "block", width: "100%", height: "100%", objectFit: "contain", background: "#000"}}/>
        {grains.map((grain, index) => {
            const left = (grain.x / width) * 100;
            const top = (grain.y / height) * 100;
            const boxWidth = (grain.width / width) * 100;
            const boxHeight = (grain.height / height) * 100;

            return <div key={`${grain.x}-${grain.y}-${index}`}
                        title={grain.confidence != null ? `${Math.round(grain.confidence * 100)}% immature` : (grain.action ?? undefined)}
                        style={{
                            position: "absolute",
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${boxWidth}%`,
                            height: `${boxHeight}%`,
                            border: `${zoom > 1 ? 2 : 1}px solid ${color ?? "#2f6f5e"}`,
                            boxSizing: "border-box",
                            borderRadius: 2,
                            background: "transparent",
                        }}/>;
        })}
    </div>;
}

function TierPanel({image, failed, grains, color, caption}: {
    image: HTMLImageElement | null;
    failed: boolean;
    grains: GrainBox[];
    color?: string;
    caption: string
}) {
    const [zoomIndex, setZoomIndex] = useState(0);
    const zoom = ZOOM_LEVELS[zoomIndex];
    const frameRef = useRef<HTMLDivElement>(null);
    const center = useRef<{ x: number; y: number } | null>(null);

    const changeZoom = (next: number) => {
        const frame = frameRef.current;
        if (frame) {
            center.current = {
                x: (frame.scrollLeft + frame.clientWidth / 2) / frame.scrollWidth,
                y: (frame.scrollTop + frame.clientHeight / 2) / frame.scrollHeight,
            };
        }
        setZoomIndex(next);
    };
    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame || !center.current) return;
        frame.scrollLeft = center.current.x * frame.scrollWidth - frame.clientWidth / 2;
        frame.scrollTop = center.current.y * frame.scrollHeight - frame.clientHeight / 2;
        center.current = null;
    }, [zoomIndex]);

    const width = image ? image.naturalWidth || image.width || 1 : 1;
    const height = image ? image.naturalHeight || image.height || 1 : 1;

    return <figure className="tier-cell">
        <div className="tier-viewport">
            <div className="tier-frame" ref={frameRef}
                 style={image ? {aspectRatio: `${width} / ${height}`} : undefined}>
                {failed ? <p className="image-message">Image unavailable</p>
                    : !image ? <p className="image-message">Loading image...</p>
                        : <GrainCanvas image={image} grains={grains} color={color} zoom={zoom}/>}
            </div>
            {image && <div className="zoom-controls" role="group" aria-label={`Zoom ${caption}`}>
                <button className="zoom-button" type="button" aria-label="Zoom out" disabled={zoomIndex === 0}
                        onClick={() => changeZoom(zoomIndex - 1)}><Minus size={16}/></button>
                <span aria-live="polite">{Math.round(zoom * 100)}%</span>
                <button className="zoom-button" type="button" aria-label="Zoom in"
                        disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                        onClick={() => changeZoom(zoomIndex + 1)}><Plus size={16}/></button>
            </div>}
        </div>
        <figcaption>{caption}</figcaption>
    </figure>;
}

function ImageTiers({record}: { record: Replicate }) {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;

        setImage(null);
        setFailed(false);

        const source = new Image();
        source.onload = () => {
            if (!cancelled) setImage(source);
        };
        source.onerror = () => {
            if (!cancelled) setFailed(true);
        };
        source.src = record.imageSecureUrl;

        return () => {
            cancelled = true;
            source.onload = null;
            source.onerror = null;
        };
    }, [record.imageSecureUrl]);

    const correctedGrains = record.confirmedGrains.filter((grain) => grain.action !== "removed");
    return (<>
        <div className="overlay-legend" aria-label="Bounding-box legend"><span> <i className="legend-swatch ai"/> AI box </span>
            <span> <i className="legend-swatch reviewer"/> Reviewer correction </span></div>
        <div className="tier-grid">
            <TierPanel image={image} failed={failed} grains={[]} caption="Raw input"/>
            <TierPanel image={image} failed={failed} grains={record.aiPredictedGrains} color="#2f6f5e"
                       caption={`AI prediction (${record.aiPredictedGrains.length})`}/>
            <TierPanel image={image} failed={failed} grains={correctedGrains} color="#b5750d"
                       caption={`Reviewer correction (${correctedGrains.length})`}/>
        </div>
    </>);
}

function SampleStatusBadge({sample}: { sample: SampleRecord }) {
    return <span className={`status-pill static ${sample.status}`}>{statusLabel(sample.status)}</span>;
}

function DetailOverlay({
                           sample,
                           record,
                           sibling,
                           isOverriding,
                           onClose,
                           onOpenStatus,
                           onSelectReplicate,
                           onToggleOverride,
                           onOpenSibling
                       }: {
    sample: SampleRecord;
    record: Replicate;
    sibling: SampleRecord | null;
    isOverriding: boolean;
    onClose: () => void;
    onOpenStatus: (anchor: HTMLElement, record: Replicate) => void;
    onSelectReplicate: (record: Replicate) => void;
    onToggleOverride: (record: Replicate) => void;
    onOpenSibling: (sample: SampleRecord) => void;
}) {
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);
    return <div className="detail-overlay open" role="presentation" onMouseDown={onClose}>
        <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title"
                 onMouseDown={(event) => event.stopPropagation()}>
            <header className="detail-header">
                <div><h2 id="detail-title">Sample detail</h2><p>{sample.sampleId}</p></div>
                <button className="icon-button" type="button" aria-label="Close sample detail" onClick={onClose}><X
                    size={20} aria-hidden="true"/></button>
            </header>
            <div className="detail-body">
                <h3 className="section-title">Sample summary</h3>
                <dl className="record-metadata">
                    <div>
                        <dt>Sample ID</dt>
                        <dd>{sample.sampleId}</dd>
                    </div>
                    <div>
                        <dt>Sample</dt>
                        <dd>{formatSampleNo(sample)}</dd>
                    </div>
                    <div>
                        <dt>Status</dt>
                        <dd><SampleStatusBadge sample={sample}/></dd>
                    </div>
                    <div>
                        <dt>Season</dt>
                        <dd>{sample.season ?? EM_DASH}</dd>
                    </div>
                    <div>
                        <dt>Index no.</dt>
                        <dd>{sample.indexNumber ?? EM_DASH}</dd>
                    </div>
                    <div>
                        <dt>Selection name</dt>
                        <dd>{sample.selectionName ?? EM_DASH}</dd>
                    </div>
                    <div>
                        <dt>Photos</dt>
                        <dd>{sample.replicateCount} ({sample.goodCount} good)</dd>
                    </div>
                    <div>
                        <dt>Average weight</dt>
                        <dd>{sample.averageWeight == null ? EM_DASH : `${sample.averageWeight} g`}</dd>
                    </div>
                    <div>
                        <dt>Average percentage</dt>
                        <dd>{sample.averagePercentage == null ? EM_DASH : `${sample.averagePercentage.toFixed(1)}%`}</dd>
                    </div>
                    <div>
                        <dt>Average grade</dt>
                        <dd>{sample.averageGrade == null ? "Pending" : formatGrade(sample.averageGrade)}</dd>
                    </div>
                    <div>
                        <dt>Recommended value</dt>
                        <dd>{sample.meetsRecommendedValue == null ? EM_DASH : sample.meetsRecommendedValue ? "Meets (below 2.0%)" : "Does not meet"}</dd>
                    </div>
                </dl>
                {sample.status !== "accepted" && <p className="override-hint">
                    The average is calculated automatically once the sample has 2 good (or manually overridden) photos.
                </p>}

                <h3 className="section-title">Photos</h3>
                <div className="photo-tabs" role="tablist" aria-label="Photos of this sample">
                    {sample.replicates.map((photo) => <button key={photo.id} type="button" role="tab"
                                                              aria-selected={photo.id === record.id}
                                                              className={`photo-tab ${photo.id === record.id ? "active" : ""}`}
                                                              onClick={() => onSelectReplicate(photo)}>
                        <span>{replicateSuffix(photo)}</span><QualityBadge record={photo}/>
                    </button>)}
                </div>

                <ImageTiers key={record.id} record={record}/>
                <dl className="record-metadata">
                    <div>
                        <dt>Replicate</dt>
                        <dd>{record.replicateLabel}</dd>
                    </div>
                    <div>
                        <dt>Quality</dt>
                        <dd><QualityBadge record={record}/></dd>
                    </div>
                    <div>
                        <dt>Confidence</dt>
                        <dd>{formatConfidence(record.confidence)}</dd>
                    </div>
                    <div>
                        <dt>Grade</dt>
                        <dd>{formatGrade(record.grade)}</dd>
                    </div>
                    <div>
                        <dt>Immature weight</dt>
                        <dd>{record.immatureWeight} g</dd>
                    </div>
                    <div>
                        <dt>Percentage</dt>
                        <dd>{record.percentage.toFixed(1)}%</dd>
                    </div>
                    <div>
                        <dt>Technician</dt>
                        <dd>{record.technicianName}</dd>
                    </div>
                    <div>
                        <dt>Captured</dt>
                        <dd>{formatOptionalDate(record.capturedAt)}</dd>
                    </div>
                    <div>
                        <dt>Submitted</dt>
                        <dd>{formatOptionalDate(record.submittedAt)}</dd>
                    </div>
                    <div>
                        <dt>Processing time</dt>
                        <dd>{formatProcessing(record)}</dd>
                    </div>
                    <div>
                        <dt>Saved</dt>
                        <dd>{formatDate(record.createdAt)}</dd>
                    </div>
                    <div>
                        <dt>Recommended value</dt>
                        <dd>{record.meetsRecommendedValue == null ? EM_DASH : record.meetsRecommendedValue ? "Meets (below 2.0%)" : "Does not meet"}</dd>
                    </div>
                    <div>
                        <dt>Record ID</dt>
                        <dd>{record.id}</dd>
                    </div>
                </dl>
                <button className={`override-button ${record.manuallyOverridden ? "active" : ""}`} type="button"
                        aria-pressed={record.manuallyOverridden} disabled={isOverriding}
                        onClick={() => onToggleOverride(record)}>
                    {record.manuallyOverridden ? "Remove manual override" : "Override: mark this photo as good"}
                </button>
                <p className="override-hint">A photo is good when its confidence is high enough or it has been manually
                    overridden.</p>
                {sibling && <button className="sibling-link" type="button" onClick={() => onOpenSibling(sibling)}>
                    View other sample of this entry ({formatSampleNo(sibling)}: {sibling.sampleId})
                </button>}
            </div>
            <footer className="detail-footer"><span>Photo status ({replicateSuffix(record)})</span><StatusPill
                record={record} onOpen={onOpenStatus}/>
            </footer>
        </section>
    </div>;
}

// ---- Entry view: results in this view are calculated by the dashboard (see entries.ts). ----

const ENTRY_HELP = "Accepted when sample 1 and sample 2 each have a Good photo. The latest Good photo of each sample counts. These results are calculated by the dashboard.";

function ComputedTag() {
    return <span className="computed-tag" title="Calculated by the dashboard from the photos">Computed in browser</span>;
}

function ServerTag() {
    return <span className="server-tag" title="Stored or calculated by the backend">Server</span>;
}

function entryTitle(entry: EntryRecord): string {
    if (entry.season && entry.indexNumber) return `${entry.season} · ${entry.indexNumber}`;
    return [...entry.samples.map((result) => result.sample), ...entry.others].find((sample) => sample)?.sampleId ?? EM_DASH;
}

function entryStatusLabel(entry: EntryRecord): string {
    return entry.status === "accepted" ? "Accepted" : "Pending";
}

function EntryStatusPill({entry}: { entry: EntryRecord }) {
    return <span className={`status-pill static ${entry.status}`}>{entryStatusLabel(entry)}</span>;
}

function formatWeight(grams: number | null): string {
    return grams == null ? EM_DASH : `${grams.toFixed(2)} g`;
}

function formatMeanWeight(grams: number | null): string {
    if (grams == null) return EM_DASH;
    const text = grams.toFixed(3);
    return `${text.endsWith("0") ? text.slice(0, -1) : text} g`;
}

function formatPercent(value: number | null): string {
    return value == null ? EM_DASH : `${value.toFixed(1)}%`;
}

function photoCount(entry: EntryRecord): number {
    return entryPhotos(entry).length;
}

function SampleCell({result}: { result: SampleResult }) {
    if (!result.sample) return <span className="cell-main muted">Not photographed</span>;
    if (!result.counting) return <>
        <span className="cell-main muted">No Good photo</span>
        <span className="cell-sub">{result.sample.replicates.length} photo(s)</span>
    </>;
    return <>
        <span className="cell-main">{formatPercent(result.percentage)} · {formatWeight(result.weight)}</span>
        <span className="cell-sub">counts: {replicateSuffix(result.counting)} of {result.sample.replicates.length}</span>
    </>;
}

function sampleSummary(result: SampleResult): string {
    if (result.counting) return formatPercent(result.percentage);
    return result.sample ? "no Good photo" : "not photographed";
}

function EntryResultText({entry}: { entry: EntryRecord }) {
    if (entry.percentage == null) return <span className="muted">Pending</span>;
    return <>{entry.grade} · {formatPercent(entry.percentage)}<ComputedTag/></>;
}

function DifferenceText({entry}: { entry: EntryRecord }) {
    if (entry.differencePoints == null) return <span className="muted">{EM_DASH}</span>;
    const text = `${entry.differencePoints.toFixed(1)} pts`;
    return entry.largeDifference ? <span className="flag">{text}</span> : <>{text}</>;
}

function openOnKey(event: React.KeyboardEvent, open: () => void) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
    }
}

function EntryCard({entry, onOpen}: { entry: EntryRecord; onOpen: (entry: EntryRecord) => void }) {
    return <article className="record-card" tabIndex={0} onClick={() => onOpen(entry)}
                    onKeyDown={(event) => openOnKey(event, () => onOpen(entry))}>
        <div className="record-card-top"><strong>{entryTitle(entry)}</strong><EntryStatusPill entry={entry}/></div>
        <p>{entry.selectionName ?? EM_DASH} · {photoCount(entry)} photos</p>
        <p>S1: {sampleSummary(entry.samples[0])} · S2: {sampleSummary(entry.samples[1])}</p>
        <p>Entry result: <EntryResultText entry={entry}/></p>
        {entry.largeDifference && entry.differencePoints != null &&
            <p><span className="flag">Large difference {entry.differencePoints.toFixed(1)} pts</span></p>}
    </article>;
}

function EntryRow({entry, onOpen}: { entry: EntryRecord; onOpen: (entry: EntryRecord) => void }) {
    return <tr tabIndex={0} onClick={() => onOpen(entry)} onKeyDown={(event) => openOnKey(event, () => onOpen(entry))}>
        <td className="mono-cell">{entryTitle(entry)}</td>
        <td>{entry.selectionName ?? EM_DASH}</td>
        <td><SampleCell result={entry.samples[0]}/></td>
        <td><SampleCell result={entry.samples[1]}/></td>
        <td><EntryResultText entry={entry}/></td>
        <td><DifferenceText entry={entry}/></td>
        <td><EntryStatusPill entry={entry}/><ComputedTag/></td>
        <td className="mono-cell">{photoCount(entry)}</td>
    </tr>;
}

function PhotoRow({photo, counts, selected, onSelect}: {
    photo: Replicate;
    counts: boolean;
    selected: boolean;
    onSelect: (photo: Replicate) => void;
}) {
    return <button type="button" className={`photo-row ${counts ? "counts" : "older"} ${selected ? "selected" : ""}`}
                   aria-pressed={selected} onClick={() => onSelect(photo)}>
        <span className="photo-row-label">{replicateSuffix(photo)}</span>
        {counts ? <span className="tag-counts">Counts</span> : <span className="tag-older">Older · not counted</span>}
        <QualityBadge record={photo}/>
        <span className={`status-pill static ${photo.reviewStatus}`}>{statusLabel(photo.reviewStatus)}</span>
        <span className="photo-row-weight">{formatWeight(photo.immatureWeight)}</span>
    </button>;
}

function SampleColumn({result, selectedId, onSelect}: {
    result: SampleResult;
    selectedId: string | null;
    onSelect: (photo: Replicate) => void;
}) {
    const sample = result.sample;
    return <div className="sample-col">
        <h4>Sample {result.sampleNo} of 2</h4>
        {!sample ? <p className="empty-sample">Not photographed yet. The entry stays Pending.</p> : <>
            <p className="sample-col-id">{sample.sampleId}</p>
            {sample.replicates.toSorted((left, right) => left.replicateNo - right.replicateNo).map((photo) =>
                <PhotoRow key={photo.id} photo={photo} counts={photo.id === result.counting?.id}
                          selected={photo.id === selectedId} onSelect={onSelect}/>)}
            {result.counting
                ? <p className="help-text strong">Sample result: <strong>{formatPercent(result.percentage)}</strong> · {formatWeight(result.weight)} · {result.grade}<ComputedTag/></p>
                : <p className="help-text">No Good photo yet.<ComputedTag/></p>}
            <p className="help-text">Server sample status (auto-accept): <span
                className={`status-pill static ${sample.status}`}>{statusLabel(sample.status)}</span> · server
                average of accepted photos: {formatWeight(sample.averageWeight)}<ServerTag/></p>
        </>}
    </div>;
}

function EntryDetail({entry, selectedId, onSelectPhoto, onClose, onOpenStatus}: {
    entry: EntryRecord;
    selectedId: string | null;
    onSelectPhoto: (photo: Replicate) => void;
    onClose: () => void;
    onOpenStatus: (anchor: HTMLElement, record: Replicate) => void;
}) {
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    const photos = entryPhotos(entry);
    const record = photos.find((photo) => photo.id === selectedId)
        ?? entry.samples[0].counting ?? entry.samples[1].counting ?? photos[0] ?? null;

    return <div className="detail-overlay open" role="presentation" onMouseDown={onClose}>
        <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="entry-detail-title"
                 onMouseDown={(event) => event.stopPropagation()}>
            <header className="detail-header">
                <div><h2 id="entry-detail-title">Entry detail</h2>
                    <p>{entryTitle(entry)}{entry.selectionName ? ` · ${entry.selectionName}` : ""}</p></div>
                <button className="icon-button" type="button" aria-label="Close entry detail" onClick={onClose}><X
                    size={20} aria-hidden="true"/></button>
            </header>
            <div className="detail-body">
                <h3 className="section-title">Entry result</h3>
                <dl className="record-metadata">
                    <div>
                        <dt>Entry status <ComputedTag/></dt>
                        <dd><EntryStatusPill entry={entry}/></dd>
                    </div>
                    <div>
                        <dt>Mean weight <ComputedTag/></dt>
                        <dd>{formatMeanWeight(entry.meanWeight)}</dd>
                    </div>
                    <div>
                        <dt>% immature <ComputedTag/></dt>
                        <dd>{formatPercent(entry.percentage)}</dd>
                    </div>
                    <div>
                        <dt>Grade <ComputedTag/></dt>
                        <dd>{entry.grade ?? "Pending"}</dd>
                    </div>
                    <div>
                        <dt>Difference S1 vs S2 <ComputedTag/></dt>
                        <dd>{entry.differencePoints == null ? EM_DASH : `${entry.differencePoints.toFixed(1)} pts`}
                            {entry.largeDifference && <> <span className="flag">Large</span></>}</dd>
                    </div>
                    <div>
                        <dt>SD of weights <ComputedTag/></dt>
                        <dd>{entry.sdWeight == null ? EM_DASH : `${entry.sdWeight.toFixed(3)} g`}</dd>
                    </div>
                    <div>
                        <dt>Season</dt>
                        <dd>{entry.season ?? EM_DASH}</dd>
                    </div>
                    <div>
                        <dt>Index no.</dt>
                        <dd>{entry.indexNumber ?? EM_DASH}</dd>
                    </div>
                    <div>
                        <dt>Photos</dt>
                        <dd>{photos.length}</dd>
                    </div>
                </dl>
                <p className="help-text">{ENTRY_HELP}</p>
                <p className="help-text">% = mean weight ÷ 30 g × 100, rounded half up to 1 decimal. Large
                    difference: more than {LARGE_DIFFERENCE_POINTS.toFixed(1)} percentage points (placeholder).</p>

                <h3 className="section-title">Samples and photos</h3>
                <div className="sample-grid">
                    <SampleColumn result={entry.samples[0]} selectedId={record?.id ?? null} onSelect={onSelectPhoto}/>
                    <SampleColumn result={entry.samples[1]} selectedId={record?.id ?? null} onSelect={onSelectPhoto}/>
                </div>
                {entry.others.length > 0 && <>
                    <h3 className="section-title">Other</h3>
                    <p className="help-text">Samples with a sample number other than 1 or 2. They never count.</p>
                    {entry.others.map((sample) => <div className="sample-col other" key={sample.sampleId}>
                        <p className="sample-col-id">{sample.sampleId} (sample no. {sample.sampleNo ?? EM_DASH})</p>
                        {sample.replicates.map((photo) => <PhotoRow key={photo.id} photo={photo} counts={false}
                                                                    selected={photo.id === record?.id}
                                                                    onSelect={onSelectPhoto}/>)}
                    </div>)}
                </>}
                <p className="help-text">Older photos stay visible for traceability. Select a photo to see it below.</p>

                {record && <>
                    <h3 className="section-title">Photo {record.replicateLabel}</h3>
                    <ImageTiers key={record.id} record={record}/>
                    <dl className="record-metadata">
                        <div>
                            <dt>Quality <ServerTag/></dt>
                            <dd><QualityBadge record={record}/></dd>
                        </div>
                        <div>
                            <dt>Confidence</dt>
                            <dd>{formatConfidence(record.confidence)}</dd>
                        </div>
                        <div>
                            <dt>Immature weight</dt>
                            <dd>{formatWeight(record.immatureWeight)}</dd>
                        </div>
                        <div>
                            <dt>Percentage <ServerTag/></dt>
                            <dd>{record.percentage.toFixed(2)}%</dd>
                        </div>
                        <div>
                            <dt>Photo grade <ServerTag/></dt>
                            <dd>{gradeDisplayName(record.grade)}</dd>
                        </div>
                        <div>
                            <dt>Technician</dt>
                            <dd>{record.technicianName}</dd>
                        </div>
                        <div>
                            <dt>Captured</dt>
                            <dd>{formatOptionalDate(record.capturedAt)}</dd>
                        </div>
                        <div>
                            <dt>Submitted</dt>
                            <dd>{formatOptionalDate(record.submittedAt)}</dd>
                        </div>
                        <div>
                            <dt>Processing time</dt>
                            <dd>{formatProcessing(record)}</dd>
                        </div>
                        <div>
                            <dt>Record ID</dt>
                            <dd>{record.id}</dd>
                        </div>
                    </dl>
                </>}
            </div>
            {record && <footer className="detail-footer"><span>Photo status ({replicateSuffix(record)}) <ServerTag/></span>
                <StatusPill record={record} onOpen={onOpenStatus}/>
            </footer>}
        </section>
    </div>;
}

function KanbanCard({record, onOpen, onOpenStatus, onDragStart, onDragEnd}: {
    record: Replicate;
    onOpen: (record: Replicate) => void;
    onOpenStatus: (anchor: HTMLElement, record: Replicate) => void;
    onDragStart: (event: React.DragEvent<HTMLElement>, record: Replicate) => void;
    onDragEnd: () => void;
}) {
    const didDrag = useRef(false);
    return <article className="kanban-card" draggable tabIndex={0} onDragStart={(event) => {
        didDrag.current = true;
        onDragStart(event, record);
    }} onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
            didDrag.current = false;
        }, 0);
    }} onClick={(event) => {
        if (didDrag.current || (event.target as HTMLElement).closest(".kanban-card-move")) return;
        onOpen(record);
    }} onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(record);
    }}>
        <div className="kanban-card-title"><GripVertical size={15}
                                                         aria-hidden="true"/><strong>{record.replicateLabel}</strong>
        </div>
        <p>{record.technicianName}</p>
        {record.indexNumber && <p>{record.season} · Index {record.indexNumber} · Sample {formatSampleNo(record)}</p>}
        <p><QualityBadge record={record}/> {formatGrade(record.grade)} · {formatConfidence(record.confidence)}</p>
        <span>{formatDate(captureTime(record))}</span>
        <button className="kanban-card-move" type="button" onClick={(event) => {
            event.stopPropagation();
            onOpenStatus(event.currentTarget, record);
        }}>Move to...
        </button>
    </article>;
}

function Dashboard() {
    const queryClient = useQueryClient();
    const [view, setView] = useState<View>("entry");
    const [filter, setFilter] = useState<EntryFilter>("all");
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
    const [entryPhotoId, setEntryPhotoId] = useState<string | null>(null);
    const [picker, setPicker] = useState<StatusPickerState | null>(null);
    const [activeKanbanTab, setActiveKanbanTab] = useState<ReviewStatus>("review");
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<ReviewStatus | null>(null);
    const {data: samples = [], error, isLoading, isError} = useQuery({
        queryKey: ["samples"],
        queryFn: fetchSamples
    });
    const records = useMemo(() => samples.flatMap((sample) => sample.replicates), [samples]);
    // Entry results are calculated in the browser from GET /api/samples.
    const entries = useMemo(() => buildEntries(samples, {largeDifferencePoints: LARGE_DIFFERENCE_POINTS}), [samples]);

    const updateMutation = useMutation({
        mutationFn: ({id, status}: { id: string; status: ReviewStatus }) => updateStatus(id, status),
        onMutate: async ({id, status}) => {
            await queryClient.cancelQueries({queryKey: ["samples"]});
            const previous = queryClient.getQueryData<SampleRecord[]>(["samples"]);
            queryClient.setQueryData<SampleRecord[]>(["samples"], (current) => patchReplicate(current, id, {reviewStatus: status}));
            return {previous};
        },
        onError: (_error, _variables, context) => queryClient.setQueryData(["samples"], context?.previous),
        onSuccess: (updated) => queryClient.setQueryData<SampleRecord[]>(["samples"], (current) => patchReplicate(current, updated.id, {reviewStatus: updated.reviewStatus})),
        // The backend may auto-accept the sample after a status change, so always refetch the grouped records.
        onSettled: () => void queryClient.invalidateQueries({queryKey: ["samples"]}),
    });

    const overrideMutation = useMutation({
        mutationFn: ({id, overridden}: { id: string; overridden: boolean }) => setManualOverride(id, overridden),
        onSuccess: (updated) => queryClient.setQueryData<SampleRecord[]>(["samples"], (current) => patchReplicate(current, updated.id, {
            manuallyOverridden: updated.manuallyOverridden,
            quality: updated.quality,
            reviewStatus: updated.reviewStatus
        })),
        // An override can complete the sample (2 good photos), which changes its status and average.
        onSettled: () => void queryClient.invalidateQueries({queryKey: ["samples"]}),
    });

    // Builds the CSV in the browser from the loaded data. It does not call the backend export.
    const [exportError, setExportError] = useState<Error | null>(null);
    const exportCsv = () => {
        setExportError(null);
        try {
            downloadRecordsCsv(entries);
        } catch (failure) {
            setExportError(failure instanceof Error ? failure : new Error("Could not export CSV."));
        }
    };

    const visibleEntries = useMemo(() => filterEntries(entries, filter, searchTerm), [entries, filter, searchTerm]);
    const selectedEntry = entries.find((entry) => entry.key === selectedEntryKey) ?? null;

    const selectedSample = samples.find((sample) => sample.replicates.some((record) => record.id === selectedId)) ?? null;
    const selectedRecord = selectedSample?.replicates.find((record) => record.id === selectedId) ?? null;
    const selectedSibling = selectedSample ? findSiblingSample(selectedSample, samples) : null;
    // Kanban columns hold individual photos, so these counts are per photo.
    const counts = useMemo(() => Object.fromEntries(STATUS_COLUMNS.map(({key}) => [key, records.filter((record) => record.reviewStatus === key).length])) as Record<ReviewStatus, number>, [records]);
    const acceptedEntries = useMemo(() => entries.filter((entry) => entry.status === "accepted").length, [entries]);
    const openStatusPicker = (anchor: HTMLElement, record: Replicate) => setPicker({anchor, record});
    const changeStatus = (record: Replicate, status: ReviewStatus) => {
        if (record.reviewStatus !== status) updateMutation.mutate({id: record.id, status});
    };
    const toggleOverride = (record: Replicate) => overrideMutation.mutate({
        id: record.id,
        overridden: !record.manuallyOverridden
    });
    const openRecord = (record: Replicate) => setSelectedId(record.id);
    const openSample = (sample: SampleRecord) => setSelectedId(sample.replicates[0].id);
    const openEntry = (entry: EntryRecord) => {
        setEntryPhotoId(null);
        setSelectedEntryKey(entry.key);
    };
    const closeEntry = useCallback(() => setSelectedEntryKey(null), []);
    const mutationError = updateMutation.error ?? overrideMutation.error ?? exportError;

    return <main className="app-shell">
        <aside className="sidebar"><p className="brand">Record checking</p>
            <nav aria-label="Dashboard views">
                <button className={view === "entry" ? "current" : ""} type="button" onClick={() => setView("entry")}>
                    <LayoutList size={18}/>Entry view
                </button>
                <button className={view === "kanban" ? "current" : ""} type="button" onClick={() => setView("kanban")}>
                    <Columns3 size={18}/>Kanban View
                </button>
                <button type="button" onClick={() => supabase.auth.signOut({scope: "local"})}>
                    <LogOut size={18}/>Logout
                </button>
            </nav>
        </aside>
        <section className="main-content">
            <header className="page-header">
                <div><h1>Record checking</h1><p>One row per entry (season + index no.). Sample 1 and sample 2 side by
                    side.</p></div>
                <div className="summary-row" aria-label="Record totals">
                    <div className="summary-chip"><strong>{entries.length}</strong><span>Entries</span></div>
                    <div className="summary-chip"><strong>{records.length}</strong><span>Photos</span></div>
                    <div className="summary-chip" title="Calculated by the dashboard">
                        <strong>{entries.length - acceptedEntries}</strong><span>Pending &#9670;</span></div>
                    <div className="summary-chip" title="Calculated by the dashboard">
                        <strong>{acceptedEntries}</strong><span>Accepted &#9670;</span></div>
                </div>
            </header>
            <section className={`view-panel entry-view ${view === "entry" ? "active" : ""}`}
                     aria-hidden={view !== "entry"}>
                <p className="tag-legend"><span><ComputedTag/> = calculated by the dashboard from the photos.</span>
                    <span><ServerTag/> = stored or calculated by the backend.</span></p>
                <div className="toolbar-filter" aria-label="Entry filters">
                    {ENTRY_FILTERS.map((option) => <button key={option.key}
                                                           className={filter === option.key ? "active" : ""}
                                                           type="button"
                                                           onClick={() => setFilter(option.key)}>{option.label}</button>)}
                </div>
                <div className="toolbar-secondary"><label className="search-field" htmlFor="record-search"><Search
                    size={17} aria-hidden="true"/><span className="visually-hidden">Search entries</span><input
                    id="record-search" type="search"
                    placeholder="Search index no., season, selection, sample, photo, technician"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}/></label>
                    <button className="export-button" type="button"
                            title="Downloads every loaded photo as CSV, with the entry results calculated by the dashboard"
                            disabled={records.length === 0}
                            onClick={exportCsv}>
                        <Download size={16} aria-hidden="true"/>Export CSV
                    </button>
                </div>
                <section className="record-list-container" aria-label="Record list">
                    {isLoading && <p className="view-message">Loading records...</p>}{isError &&
                    <p className="view-message error-message" role="alert">Could not load
                        records: {error instanceof Error ? error.message : "Unknown error"}</p>}{!isLoading && !isError && samples.length === 0 &&
                    <p className="view-message">No submissions yet.</p>}
                    {!isLoading && !isError && samples.length > 0 && <>
                        <div className="record-list-scroll">{visibleEntries.map((entry) => <EntryCard
                            key={entry.key}
                            entry={entry}
                            onOpen={openEntry}/>)}{visibleEntries.length === 0 &&
                            <p className="view-message">No entries match the current filters.</p>}</div>
                        <div className="record-table-wrap">
                            <table className="entry-table">
                                <thead>
                                <tr>
                                    <th>Entry (season · index no.)</th>
                                    <th>Selection</th>
                                    <th>Sample 1</th>
                                    <th>Sample 2</th>
                                    <th>Entry result</th>
                                    <th>Difference</th>
                                    <th>Entry status</th>
                                    <th>Photos</th>
                                </tr>
                                </thead>
                                <tbody>{visibleEntries.map((entry) => <EntryRow key={entry.key} entry={entry}
                                                                                onOpen={openEntry}/>)}
                                {visibleEntries.length === 0 && <tr>
                                    <td className="view-message" colSpan={8}>No entries match the current filters.</td>
                                </tr>}</tbody>
                            </table>
                        </div>
                    </>}
                </section>
            </section>
            <section className={`view-panel kanban-view ${view === "kanban" ? "active" : ""}`}
                     aria-hidden={view !== "kanban"}>
                <div className="kanban-status-tabs" role="tablist"
                     aria-label="Kanban status columns">{STATUS_COLUMNS.map((column) => <button key={column.key}
                                                                                                className={`${column.key} ${activeKanbanTab === column.key ? "active" : ""}`}
                                                                                                type="button" role="tab"
                                                                                                aria-selected={activeKanbanTab === column.key}
                                                                                                onClick={() => setActiveKanbanTab(column.key)}>
                    <span className="status-dot"/>{column.label}<b>{counts[column.key]}</b></button>)}</div>
                <div className="kanban-column-mobile">
                    <div className="kanban-column-heading"><span
                        className={`status-dot ${activeKanbanTab}`}/>{statusLabel(activeKanbanTab)}<b>{counts[activeKanbanTab]}</b>
                    </div>
                    <div
                        className="kanban-column-body">{records.filter((record) => record.reviewStatus === activeKanbanTab).map((record) =>
                        <KanbanCard key={record.id} record={record} onOpen={openRecord} onOpenStatus={openStatusPicker}
                                    onDragStart={() => undefined} onDragEnd={() => undefined}/>)}</div>
                </div>
                <div className="kanban-board-desktop">{STATUS_COLUMNS.map((column) => <section key={column.key}
                                                                                               className={`kanban-column ${dropTarget === column.key ? "drag-over" : ""}`}
                                                                                               onDragOver={(event) => {
                                                                                                   event.preventDefault();
                                                                                                   setDropTarget(column.key);
                                                                                               }}
                                                                                               onDragLeave={(event) => {
                                                                                                   if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
                                                                                               }} onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("text/plain") || draggedId;
                    const record = records.find((candidate) => candidate.id === id);
                    if (record && record.reviewStatus !== column.key) changeStatus(record, column.key);
                    setDraggedId(null);
                    setDropTarget(null);
                }}>
                    <header className="kanban-column-heading"><span
                        className={`status-dot ${column.key}`}/>{column.label}<b>{counts[column.key]}</b></header>
                    <div
                        className="kanban-column-body">{records.filter((record) => record.reviewStatus === column.key).map((record) =>
                        <KanbanCard key={record.id} record={record} onOpen={openRecord} onOpenStatus={openStatusPicker}
                                    onDragStart={(event, candidate) => {
                                        event.dataTransfer.setData("text/plain", candidate.id);
                                        event.dataTransfer.effectAllowed = "move";
                                        setDraggedId(candidate.id);
                                    }} onDragEnd={() => {
                            setDraggedId(null);
                            setDropTarget(null);
                        }}/>)}</div>
                </section>)}</div>
            </section>
        </section>
        <nav className="mobile-tab-bar" aria-label="Dashboard views">
            <button className={view === "entry" ? "current" : ""} type="button" onClick={() => setView("entry")}>
                <LayoutList size={20}/><span>Entries</span></button>
            <button className={view === "kanban" ? "current" : ""} type="button" onClick={() => setView("kanban")}>
                <Columns3 size={20}/><span>Kanban</span></button>
        </nav>
        {selectedSample && selectedRecord && <DetailOverlay sample={selectedSample} record={selectedRecord}
                                                            sibling={selectedSibling}
                                                            isOverriding={overrideMutation.isPending}
                                                            onClose={() => setSelectedId(null)}
                                                            onOpenStatus={openStatusPicker}
                                                            onSelectReplicate={openRecord}
                                                            onToggleOverride={toggleOverride}
                                                            onOpenSibling={openSample}/>}
        {selectedEntry && <EntryDetail entry={selectedEntry} selectedId={entryPhotoId}
                                       onSelectPhoto={(photo) => setEntryPhotoId(photo.id)}
                                       onClose={closeEntry}
                                       onOpenStatus={openStatusPicker}/>}
        <StatusPicker picker={picker} isUpdating={updateMutation.isPending} onSelect={changeStatus}
                      onClose={() => setPicker(null)}/>
        {mutationError && <p className="mutation-toast"
                             role="alert">{mutationError instanceof Error ? mutationError.message : "Something went wrong. Please try again."}</p>}
    </main>;
}

function App() {
    return <AuthGate><Dashboard/></AuthGate>;
}

export default App;