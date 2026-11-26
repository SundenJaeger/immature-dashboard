// Browser CSV export: one row per photo, with the sample and entry results that the
// dashboard calculates (see entries.ts). The photo columns follow the server CSV
// (ImmatureBackend ReplicateCsvRow) where the dashboard receives the field.

import type {EntryRecord, SampleResult} from "./entries";
import {entryPhotos} from "./entries";
import type {Replicate} from "./types";

type Cell = string | number | boolean | null | undefined;

interface RowContext {
    entry: EntryRecord;
    result: SampleResult | null;
    photo: Replicate;
}

const fixed = (value: number | null, digits: number): string => value == null ? "" : value.toFixed(digits);

const COLUMNS: Array<{ label: string; value: (row: RowContext) => Cell }> = [
    {label: "id", value: ({photo}) => photo.id},
    {label: "technician_name", value: ({photo}) => photo.technicianName},
    {label: "season", value: ({photo}) => photo.season},
    {label: "index_number", value: ({photo}) => photo.indexNumber},
    {label: "selection_name", value: ({photo}) => photo.selectionName},
    {label: "sample_id", value: ({photo}) => photo.sampleId},
    {label: "sample_no", value: ({photo}) => photo.sampleNo},
    {label: "immature_weight", value: ({photo}) => photo.immatureWeight},
    {label: "percentage", value: ({photo}) => photo.percentage},
    {label: "grade", value: ({photo}) => photo.grade},
    {label: "meets_recommended_value", value: ({photo}) => photo.meetsRecommendedValue},
    {label: "review_status", value: ({photo}) => photo.reviewStatus},
    {label: "captured_at", value: ({photo}) => photo.capturedAt},
    {label: "submitted_at", value: ({photo}) => photo.submittedAt},
    {label: "processing_seconds", value: ({photo}) => photo.processingSeconds},
    {label: "created_at", value: ({photo}) => photo.createdAt},
    {label: "image_secure_url", value: ({photo}) => photo.imageSecureUrl},
    {label: "ai_predicted_grains", value: ({photo}) => JSON.stringify(photo.aiPredictedGrains)},
    {label: "confirmed_grains", value: ({photo}) => JSON.stringify(photo.confirmedGrains)},
    {label: "replicate_no", value: ({photo}) => photo.replicateNo},
    {label: "replicate_label", value: ({photo}) => photo.replicateLabel},
    {label: "confidence", value: ({photo}) => photo.confidence},
    {label: "quality", value: ({photo}) => photo.quality},
    {label: "manually_overridden", value: ({photo}) => photo.manuallyOverridden},
    {label: "counts_for_sample", value: ({result, photo}) => result?.counting?.id === photo.id},
    {label: "sample_weight", value: ({result}) => fixed(result?.weight ?? null, 2)},
    {label: "sample_percentage", value: ({result}) => fixed(result?.percentage ?? null, 1)},
    {label: "sample_grade", value: ({result}) => result?.grade},
    {label: "entry_status", value: ({entry}) => entry.status},
    {label: "entry_mean_weight", value: ({entry}) => fixed(entry.meanWeight, 3)},
    {label: "entry_percentage", value: ({entry}) => fixed(entry.percentage, 1)},
    {label: "entry_grade", value: ({entry}) => entry.grade},
    {label: "entry_difference_points", value: ({entry}) => fixed(entry.differencePoints, 1)},
    {label: "entry_sd_weight", value: ({entry}) => fixed(entry.sdWeight, 3)},
    {label: "computed_by_dashboard", value: () => true},
];

export const CSV_HEADER = COLUMNS.map((column) => column.label);

/**
 * Quote one field. A value that starts with =, +, - or @ (or a tab or carriage return)
 * gets a leading single quote, so a spreadsheet does not run it as a formula.
 */
export function csvField(value: Cell): string {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

function rows(entries: EntryRecord[]): RowContext[] {
    return entries.toSorted((left, right) => left.key.localeCompare(right.key)).flatMap((entry) => {
        const resultFor = (photo: Replicate) => entry.samples.find((result) => result.sample?.replicates.includes(photo)) ?? null;
        return entryPhotos(entry)
            .toSorted((left, right) => (left.sampleNo ?? 0) - (right.sampleNo ?? 0) || left.replicateNo - right.replicateNo)
            .map((photo) => ({entry, result: resultFor(photo), photo}));
    });
}

export function buildRecordsCsv(entries: EntryRecord[]): string {
    const lines = [
        CSV_HEADER.map(csvField).join(","),
        ...rows(entries).map((row) => COLUMNS.map((column) => csvField(column.value(row))).join(",")),
    ];
    return lines.join("\r\n") + "\r\n";
}

/** granular-records-YYYYMMDD.csv, using the local date. */
export function csvFileName(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `granular-records-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.csv`;
}

export function downloadRecordsCsv(entries: EntryRecord[], now: Date = new Date()): void {
    const blob = new Blob(["﻿", buildRecordsCsv(entries)], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
