// Entry rule for the dashboard. Pure functions only: no React, no fetch.
//
// An entry is one season + index number. It has two duplicate samples (sample 1 and sample 2).
// A sample counts its latest Good, non-rejected photo. The entry is Accepted when both samples
// have a counting photo. The entry result is the mean of the two counting weights, then
// % immature = mean weight / 30 g x 100, rounded half up to 1 decimal, then the NCT grade.
//
// Every rounding step uses integer centigrams. Floating-point rounding is not used, because
// (1.48 + 1.49) / 2 / 30 * 100 is 4.949999... in JavaScript and would round to 4.9 instead of 5.0.
//
// These results are calculated by the dashboard. The backend still stores and exports its own
// photo statuses and sample averages, which follow the older "two good photos" rule.

import type {Replicate, SampleRecord} from "./types";

/**
 * Large difference between sample 1 and sample 2, in percentage points.
 * PLACEHOLDER: the team must confirm this value. It is not taken from the NCT document.
 */
export const LARGE_DIFFERENCE_POINTS = 2.0;

/** Sample weight in grams for % immature (NCT duplicate 30-g samples). */
export const SAMPLE_MASS_GRAMS = 30;

export type EntryStatus = "accepted" | "pending";

export type EntryGrade = "Premium" | "Grade 1" | "Grade 2" | "Grade 3" | "Not classified";

export interface SampleResult {
    sampleNo: 1 | 2;
    /** Null when this sample was never photographed. */
    sample: SampleRecord | null;
    /** Latest Good, non-rejected photo. Null when there is none. */
    counting: Replicate | null;
    /** Every other photo of the sample, kept for traceability. Sorted by replicate number. */
    older: Replicate[];
    /** Counting weight in grams. */
    weight: number | null;
    /** Counting weight / 30 g x 100, rounded half up to 1 decimal. */
    percentage: number | null;
    grade: EntryGrade | null;
}

export interface EntryRecord {
    key: string;
    season: string | null;
    indexNumber: string | null;
    selectionName: string | null;
    samples: [SampleResult, SampleResult];
    /** Samples with a sample number other than 1 or 2. They never count. */
    others: SampleRecord[];
    status: EntryStatus;
    /** Mean of the two counting weights in grams (up to 3 decimals). */
    meanWeight: number | null;
    /** Mean weight / 30 g x 100, rounded half up to 1 decimal. */
    percentage: number | null;
    grade: EntryGrade | null;
    /** |sample 1 % - sample 2 %| in percentage points, 1 decimal. */
    differencePoints: number | null;
    /** Sample standard deviation of the two weights in grams: |a - b| / sqrt(2). */
    sdWeight: number | null;
    largeDifference: boolean;
}

export interface BuildEntriesOptions {
    largeDifferencePoints: number;
}

/** Weight in grams to integer centigrams. Weights are stored with 2 decimals. */
export function toCentigrams(grams: number): number {
    return Math.round(grams * 100);
}

/**
 * % immature x 10 for one weight, rounded half up.
 * % = (cg / 100) / 30 x 100 = cg / 30. Tenths = cg / 3. round_half_up(cg / 3) = floor((2cg + 3) / 6).
 */
export function percentTenthsOfWeight(cg: number): number {
    return Math.floor((2 * cg + 3) / 6);
}

/**
 * % immature x 10 for the mean of two weights, rounded half up.
 * Mean = s / 2 cg, with s = cg1 + cg2. Tenths = s / 6. round_half_up(s / 6) = floor((s + 3) / 6).
 */
export function percentTenthsOfMean(sumCg: number): number {
    return Math.floor((sumCg + 3) / 6);
}

/** NCT Table 4 grade from % x 10. */
export function gradeFromTenths(tenths: number): EntryGrade {
    if (tenths < 20) return "Premium";
    if (tenths <= 50) return "Grade 1";
    if (tenths <= 100) return "Grade 2";
    if (tenths <= 150) return "Grade 3";
    return "Not classified";
}

/** Display name for a grade value from the API. The API value itself is not changed. */
export function gradeDisplayName(apiGrade: string | null): string | null {
    if (apiGrade == null) return null;
    const names: Record<string, string> = {
        Pr: "Premium",
        G1: "Grade 1",
        G2: "Grade 2",
        G3: "Grade 3",
        "Not Classified": "Not classified",
        "Below Standard": "Not classified",
    };
    return names[apiGrade] ?? apiGrade;
}

export function isCountable(photo: Replicate): boolean {
    return photo.quality === "good" && photo.reviewStatus !== "rejected";
}

function sampleResult(sampleNo: 1 | 2, sample: SampleRecord | null): SampleResult {
    const photos = sample ? sample.replicates.toSorted((left, right) => left.replicateNo - right.replicateNo) : [];
    const counting = photos.filter(isCountable).at(-1) ?? null;
    const cg = counting ? toCentigrams(counting.immatureWeight) : null;
    const tenths = cg == null ? null : percentTenthsOfWeight(cg);
    return {
        sampleNo,
        sample,
        counting,
        older: photos.filter((photo) => photo !== counting),
        weight: cg == null ? null : cg / 100,
        percentage: tenths == null ? null : tenths / 10,
        grade: tenths == null ? null : gradeFromTenths(tenths),
    };
}

/** Entry key. Rows without season or index number keep their own key so they never merge. */
export function entryKey(sample: Pick<SampleRecord, "season" | "indexNumber" | "sampleId">): string {
    return sample.season && sample.indexNumber
        ? `${sample.season}|${sample.indexNumber}`
        : `?|${sample.sampleId}`;
}

interface Group {
    key: string;
    season: string | null;
    indexNumber: string | null;
    selectionName: string | null;
    sample1: SampleRecord | null;
    sample2: SampleRecord | null;
    others: SampleRecord[];
}

export function buildEntries(samples: SampleRecord[], options: BuildEntriesOptions): EntryRecord[] {
    const groups = new Map<string, Group>();
    for (const sample of samples) {
        const key = entryKey(sample);
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                season: sample.season,
                indexNumber: sample.indexNumber,
                selectionName: sample.selectionName,
                sample1: null,
                sample2: null,
                others: [],
            };
            groups.set(key, group);
        }
        group.selectionName ??= sample.selectionName;
        if (sample.sampleNo === 1 && !group.sample1) group.sample1 = sample;
        else if (sample.sampleNo === 2 && !group.sample2) group.sample2 = sample;
        else group.others.push(sample);
    }

    return [...groups.values()].map((group) => {
        const s1 = sampleResult(1, group.sample1);
        const s2 = sampleResult(2, group.sample2);
        const entry: EntryRecord = {
            key: group.key,
            season: group.season,
            indexNumber: group.indexNumber,
            selectionName: group.selectionName,
            samples: [s1, s2],
            others: group.others,
            status: "pending",
            meanWeight: null,
            percentage: null,
            grade: null,
            differencePoints: null,
            sdWeight: null,
            largeDifference: false,
        };
        if (!s1.counting || !s2.counting) return entry;

        const cg1 = toCentigrams(s1.counting.immatureWeight);
        const cg2 = toCentigrams(s2.counting.immatureWeight);
        const sum = cg1 + cg2;
        const tenths = percentTenthsOfMean(sum);
        const differenceTenths = Math.abs(percentTenthsOfWeight(cg1) - percentTenthsOfWeight(cg2));
        entry.status = "accepted";
        entry.meanWeight = sum / 200;
        entry.percentage = tenths / 10;
        entry.grade = gradeFromTenths(tenths);
        entry.differencePoints = differenceTenths / 10;
        entry.sdWeight = Math.abs(cg1 - cg2) / 100 / Math.SQRT2;
        entry.largeDifference = differenceTenths > Math.round(options.largeDifferencePoints * 10);
        return entry;
    });
}

export type EntryFilter = "all" | "accepted" | "pending" | "large" | "rejected" | "retraining";

export const ENTRY_FILTERS: Array<{ key: EntryFilter; label: string }> = [
    {key: "all", label: "All"},
    {key: "accepted", label: "Accepted entries"},
    {key: "pending", label: "Pending"},
    {key: "large", label: "Large difference"},
    {key: "rejected", label: "Has rejected"},
    {key: "retraining", label: "Has retraining"},
];

/** Every photo of the entry, including samples under "Other". */
export function entryPhotos(entry: EntryRecord): Replicate[] {
    return [...entry.samples.map((result) => result.sample), ...entry.others]
        .flatMap((sample) => sample ? sample.replicates : []);
}

export function entryMatchesFilter(entry: EntryRecord, filter: EntryFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "accepted":
        case "pending":
            return entry.status === filter;
        case "large":
            return entry.largeDifference;
        case "rejected":
        case "retraining":
            return entryPhotos(entry).some((photo) => photo.reviewStatus === filter);
    }
}

/** Same search fields as the former sample list: sample, index no., season, selection, photo ID, label, technician. */
export function entryMatchesSearch(entry: EntryRecord, term: string): boolean {
    const needle = term.trim().toLowerCase();
    if (!needle) return true;
    const samples = [...entry.samples.map((result) => result.sample), ...entry.others]
        .filter((sample): sample is SampleRecord => sample != null);
    const fields = [
        entry.season,
        entry.indexNumber,
        entry.selectionName,
        ...samples.flatMap((sample) => [sample.sampleId, sample.indexNumber, sample.season, sample.selectionName]),
        ...samples.flatMap((sample) => sample.replicates.flatMap((photo) => [photo.id, photo.replicateLabel, photo.technicianName])),
    ];
    return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

export function filterEntries(entries: EntryRecord[], filter: EntryFilter, term: string): EntryRecord[] {
    return entries
        .filter((entry) => entryMatchesFilter(entry, filter) && entryMatchesSearch(entry, term))
        .toSorted((left, right) => left.key.localeCompare(right.key));
}
